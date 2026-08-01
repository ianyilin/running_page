import argparse
import getpass
import os
import warnings

os.environ["GARTH_TELEMETRY_ENABLED"] = "false"
warnings.filterwarnings("ignore", message="Garth is deprecated", category=DeprecationWarning)

import garth
from garth.exc import GarthHTTPError


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a Garmin Connect secret string.")
    parser.add_argument("email", nargs="?", help="Garmin Connect email")
    parser.add_argument("password", nargs="?", help="Garmin Connect password")
    parser.add_argument("--is-cn", action="store_true", help="use Garmin China")
    args = parser.parse_args()

    email = args.email or input("Garmin email: ")
    password = args.password or getpass.getpass("Garmin password: ")

    if args.is_cn:
        garth.configure(domain="garmin.cn", ssl_verify=False)

    try:
        garth.login(email, password)
    except GarthHTTPError as exc:
        message = str(exc)
        if "429" in message or "Too Many Requests" in message:
            raise SystemExit(
                "Garmin SSO returned 429 Too Many Requests. "
                "Stop retrying for now, wait a few hours or try from a different "
                "network, then run this command once. Garmin web/app login may "
                "still work while this script login endpoint is rate limited."
            ) from exc
        raise
    print(garth.client.dumps())


if __name__ == "__main__":
    main()
