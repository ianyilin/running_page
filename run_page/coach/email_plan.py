import os
import smtplib
import ssl
from email.message import EmailMessage


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing {name}")
    return value


def render_email(plan: dict, context: dict) -> str:
    summary_7 = context.get("summary", {}).get("last_7_days", {})
    summary_14 = context.get("summary", {}).get("last_14_days", {})
    signals = context.get("signals", {})
    cautions = plan.get("cautions") or []
    cautions_text = "\n".join(f"- {item}" for item in cautions) or "- 无"
    week_plan = plan.get("week_plan") or context.get("planner", {}).get("week_plan") or []
    week_rows = []
    for day in week_plan:
        planned = day.get("planned") or {}
        actual = day.get("actual") or {}
        if actual:
            status = f"完成 {actual.get('distance_km')} km / {actual.get('duration_min')} min"
            workout = ", ".join(actual.get("workout_types") or [])
        else:
            status = "计划"
            workout = planned.get("workout_type", "rest")
        week_rows.append(
            f"| {day.get('date')} {day.get('weekday')} | {workout} | {status} |"
        )
    week_table = "\n".join(
        ["| 日期 | 训练 | 状态 |", "|---|---|---|", *week_rows]
    )
    pace = plan.get("target_pace_min_per_km") or {}
    pace_text = pace.get("display") if isinstance(pace, dict) else None
    hr_zone = plan.get("target_hr_zone") or "按体感"
    workout_steps = []
    for step in plan.get("structured_workout") or []:
        if step.get("type") == "repeat":
            workout_steps.append(
                f"- {step.get('name')}: {step.get('repetitions')} x "
                f"{step.get('work_min')} min / recover {step.get('recovery_min')} min, "
                f"target {step.get('target')}"
            )
        else:
            workout_steps.append(
                f"- {step.get('name')}: {step.get('duration_min')} min, "
                f"target {step.get('target')}"
            )
    workout_steps_text = "\n".join(workout_steps) or "- 按主训练说明执行"

    return f"""训练日建议：{plan.get("workout_type")}

日期：{plan.get("date")}
结论：{plan.get("run_or_rest")}
时长：{plan.get("duration_min")} 分钟
距离：{plan.get("distance_km")} km
强度：{plan.get("intensity")}
心率目标：{hr_zone}
配速目标：{pace_text or "按体感，不追配速"}

热身：
{plan.get("warmup")}

主训练：
{plan.get("main_set")}

放松：
{plan.get("cooldown")}

Apple Watch 设置参考：
{workout_steps_text}

为什么这样安排：
{plan.get("rationale")}

注意：
{cautions_text}

本周计划与完成情况：
{week_table}

最近训练摘要：
- 过去 7 天：{summary_7.get("run_count", 0)} 次，{summary_7.get("total_distance_km", 0)} km，{summary_7.get("total_time_min", 0)} 分钟
- 过去 14 天：{summary_14.get("run_count", 0)} 次，{summary_14.get("total_distance_km", 0)} km
- 疲劳信号：{signals.get("fatigue_signal")}
- 保护规则：{signals.get("recommended_guardrail")}
"""


def send_plan_email(plan: dict, context: dict) -> None:
    host = _required_env("SMTP_HOST")
    port = int(os.environ.get("SMTP_PORT") or "587")
    username = _required_env("SMTP_USER")
    password = _required_env("SMTP_PASSWORD")
    sender = _required_env("COACH_EMAIL_FROM")
    recipient = _required_env("COACH_EMAIL_TO")

    message = EmailMessage()
    message["Subject"] = plan.get("email_subject") or "跑步训练计划"
    message["From"] = sender
    message["To"] = recipient
    message.set_content(render_email(plan, context))

    if port == 465:
        context_ssl = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=context_ssl, timeout=30) as smtp:
            smtp.login(username, password)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            smtp.login(username, password)
            smtp.send_message(message)
