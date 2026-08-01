import argparse
import base64
import json
import os
import re
import warnings
import webbrowser
from dataclasses import asdict
from urllib.parse import parse_qs, urlencode, urlparse

os.environ["GARTH_TELEMETRY_ENABLED"] = "false"
warnings.filterwarnings("ignore", message="Garth is deprecated", category=DeprecationWarning)

from garth.http import Client
from garth.sso import exchange, get_oauth1_token
from requests import HTTPError


GARMIN_CONFIG = {
    "COM": {
        "domain": "garmin.com",
        "sso": "https://sso.garmin.com/sso",
        "service": "https://mobile.integration.garmin.com/gcm/android",
    },
    "CN": {
        "domain": "garmin.cn",
        "sso": "https://sso.garmin.cn/sso",
        "service": "https://mobile.integration.garmin.cn/gcm/android",
    },
}


def build_signin_url(sso_base: str, service_url: str) -> str:
    params = {
        "id": "gauth-widget",
        "embedWidget": "true",
        "gauthHost": sso_base,
        "service": service_url,
        "source": service_url,
        "redirectAfterAccountLoginUrl": service_url,
        "redirectAfterAccountCreationUrl": service_url,
    }
    return f"{sso_base}/signin?{urlencode(params)}"


def extract_ticket(value: str) -> str:
    value = value.strip()
    if value.startswith("ST-"):
        return value

    match = re.search(r"serviceTicket['\"]?\s*:\s*['\"](ST-[^'\"\s,}]+)", value)
    if match:
        return match.group(1)

    match = re.search(r"\b(ST-[A-Za-z0-9_-]+(?:-[A-Za-z0-9_-]+)*)\b", value)
    if match:
        return match.group(1)

    parsed = urlparse(value)
    query = parse_qs(parsed.query)
    ticket = query.get("ticket", [""])[0]
    if not ticket:
        fragment_query = parse_qs(parsed.fragment)
        ticket = fragment_query.get("ticket", [""])[0]
    if not ticket.startswith("ST-"):
        raise SystemExit(
            "Could not find a Garmin CAS ticket. Paste the full browser URL after "
            "Garmin redirects to a URL containing ticket=ST-..."
        )
    return ticket


def create_secret(ticket: str, domain: str) -> str:
    client = Client()
    client.configure(domain=domain, ssl_verify=domain != "garmin.cn")
    try:
        oauth1 = get_oauth1_token(ticket, client)
        oauth2 = exchange(oauth1, client, login=True)
    except HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status == 401:
            raise SystemExit(
                "Garmin rejected this browser ticket with 401 Unauthorized. "
                "The ticket is usually single-use and short-lived; get a fresh "
                "ticket from the browser login and paste it immediately."
            ) from exc
        raise
    payload = json.dumps([asdict(oauth1), asdict(oauth2)])
    return base64.b64encode(payload.encode()).decode()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create a Garmin Connect secret from a browser login ticket."
    )
    parser.add_argument("--is-cn", action="store_true", help="use Garmin China")
    parser.add_argument(
        "--no-open",
        action="store_true",
        help="print the Garmin login URL without opening a browser",
    )
    parser.add_argument(
        "--ticket",
        help="Garmin CAS ticket or final browser URL containing ticket=ST-...",
    )
    args = parser.parse_args()

    config = GARMIN_CONFIG["CN" if args.is_cn else "COM"]
    if args.ticket:
        ticket = extract_ticket(args.ticket)
    else:
        signin_url = build_signin_url(config["sso"], config["service"])
        print("Open this Garmin login URL:")
        print(signin_url)
        if not args.no_open:
            webbrowser.open(signin_url)
        print()
        print("After Garmin login redirects, copy the full browser URL containing ticket=ST-...")
        ticket = extract_ticket(input("Paste Garmin redirect URL or ticket: "))

    print(create_secret(ticket, config["domain"]))


if __name__ == "__main__":
    main()
