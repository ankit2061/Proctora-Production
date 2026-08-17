"""
main.py
────────
CLI entry point for the Multi-Modal Biometric Proctoring System.

Commands:
  python main.py --register <user_id>
  python main.py --start-exam <user_id> [--interval <seconds>]
  python main.py --list-users
  python main.py --reset-user <user_id>
"""

import argparse
import json
import logging
import signal
import sys
import time
from datetime import datetime
from pathlib import Path

from colorama import Fore, Style, init as colorama_init

from exam_proctor import ExamProctor, VIOLATION_SCORE_LIMIT, LOG_FILE

# ─────────────────────────────────────────────────────────────────────────────
# Initialise colorama (Windows-safe ANSI colours)
# ─────────────────────────────────────────────────────────────────────────────
colorama_init(autoreset=True)

# ─────────────────────────────────────────────────────────────────────────────
# Logging – console + file
# ─────────────────────────────────────────────────────────────────────────────
LOG_FORMAT = "%(asctime)s  %(levelname)-8s  %(name)s — %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

logging.basicConfig(
    level=logging.INFO,
    format=LOG_FORMAT,
    datefmt=DATE_FORMAT,
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("proctor_system.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger("main")


# ─────────────────────────────────────────────────────────────────────────────
# Banner
# ─────────────────────────────────────────────────────────────────────────────
BANNER = f"""
{Fore.CYAN}╔══════════════════════════════════════════════════════╗
║   Multi-Modal Biometric Proctoring System v1.0       ║
║   Face (FaceNet) + Voice (ECAPA-TDNN) + ChromaDB     ║
╚══════════════════════════════════════════════════════╝{Style.RESET_ALL}
"""


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def _print_ok(msg: str):   print(f"{Fore.GREEN}  ✓  {msg}{Style.RESET_ALL}")
def _print_err(msg: str):  print(f"{Fore.RED}  ✗  {msg}{Style.RESET_ALL}")
def _print_warn(msg: str): print(f"{Fore.YELLOW}  ⚠  {msg}{Style.RESET_ALL}")
def _print_info(msg: str): print(f"{Fore.CYAN}  ▸  {msg}{Style.RESET_ALL}")


def _print_log_summary(user_id: str = None):
    """Print a short summary of proctor_logs.json to console."""
    if not Path(LOG_FILE).exists():
        print("  No log file found yet.")
        return
    try:
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            entries = json.load(f)
    except Exception:
        print("  Could not read log file.")
        return

    if user_id:
        entries = [e for e in entries if e.get("user_id") == user_id]

    if not entries:
        print("  No entries in log for this user.")
        return

    print(f"\n{Fore.CYAN}  ──── Last {min(5, len(entries))} log entries ──── {Style.RESET_ALL}")
    from tabulate import tabulate
    rows = []
    for e in entries[-5:]:
        rows.append([
            e.get("timestamp", "")[:19],
            e.get("event",     "–"),
            e.get("user_id",   "–"),
            e.get("face_cosine_distance",  "–"),
            e.get("voice_cosine_distance", "–"),
            e.get("violation_score",       "–"),
        ])
    print(tabulate(
        rows,
        headers=["Timestamp", "Event", "User", "Face Dist", "Voice Dist", "Violations"],
        tablefmt="rounded_outline",
    ))
    print()


# ─────────────────────────────────────────────────────────────────────────────
# Command Handlers
# ─────────────────────────────────────────────────────────────────────────────
def cmd_register(proctor: ExamProctor, user_id: str):
    _print_info(f"Starting enrollment for user: '{user_id}'")
    print(f"{Fore.YELLOW}  Tips for best results:{Style.RESET_ALL}")
    print("    • Ensure your face is well-lit and centred in the frame.")
    print("    • Speak clearly during the voice sample (read anything aloud).")
    print()

    success = proctor.register(user_id)
    if success:
        _print_ok(f"Enrollment complete for '{user_id}'.")
        _print_info(f"You can now run:  python main.py --start-exam {user_id}")
    else:
        _print_err("Enrollment failed. Check camera/microphone and try again.")
        sys.exit(1)


def cmd_start_exam(proctor: ExamProctor, user_id: str, check_interval: int):
    _print_info(f"Starting exam session for '{user_id}'…")

    # ── Step 1: Verification Gate ──────────────────────────────────────────
    print(f"\n{Fore.CYAN}  Step 1/2 — Identity Verification{Style.RESET_ALL}")
    ok, msg = proctor.verify(user_id)

    if not ok:
        _print_err(f"Verification FAILED: {msg}")
        _print_warn("Exam access denied. Exiting.")
        sys.exit(1)

    _print_ok(f"Identity verified: {msg}")

    # ── Step 2: Start Background Monitor ────────────────────────────────────
    print(f"\n{Fore.CYAN}  Step 2/2 — Starting Background Proctoring Monitor{Style.RESET_ALL}")
    _print_info(
        f"Identity checks every {check_interval}s. "
        f"Limit: {VIOLATION_SCORE_LIMIT} violations before FLAG."
    )
    _print_info(f"All events are logged to '{LOG_FILE}'.")

    proctor.start_monitoring(user_id, check_interval=check_interval)

    _print_ok("Exam session LIVE. Press Ctrl+C to end it manually.\n")

    # ── Graceful shutdown on Ctrl+C / SIGTERM ────────────────────────────────
    def _shutdown(signum=None, frame=None):
        print(f"\n{Fore.YELLOW}  Shutting down proctoring session…{Style.RESET_ALL}")
        proctor.stop_monitoring()

        end_entry = {
            "event":     "EXAM_ENDED",
            "user_id":   user_id,
            "timestamp": datetime.now().isoformat(),
            "reason":    "Manual termination by user / signal",
        }
        import exam_proctor as ep
        ep._append_log(end_entry, LOG_FILE)

        _print_log_summary(user_id)
        _print_ok("Session ended. Goodbye.")
        sys.exit(0)

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    # ── Keep the main thread alive ────────────────────────────────────────────
    try:
        while proctor._monitor_thread and proctor._monitor_thread.is_alive():
            time.sleep(1)
    except KeyboardInterrupt:
        _shutdown()

    # If monitor thread died naturally (e.g. FLAG_USER)
    _print_log_summary(user_id)


def cmd_list_users(proctor: ExamProctor):
    """List all enrolled users from ChromaDB."""
    try:
        results = proctor._face_col.get(include=["metadatas"])
        if not results["ids"]:
            _print_warn("No users are enrolled yet.")
            return
        users = sorted({m["user_id"] for m in results["metadatas"]})
        print(f"\n{Fore.CYAN}  Enrolled users:{Style.RESET_ALL}")
        for u in users:
            _print_ok(u)
        print()
    except Exception as e:
        _print_err(f"Could not list users: {e}")


def cmd_reset_user(proctor: ExamProctor, user_id: str):
    """Remove a user's embeddings from ChromaDB."""
    face_id  = f"face_{user_id}"
    voice_id = f"voice_{user_id}"
    try:
        proctor._face_col.delete(ids=[face_id])
        proctor._voice_col.delete(ids=[voice_id])
        _print_ok(f"Embeddings for '{user_id}' deleted. Re-register to enrol again.")
    except Exception as e:
        _print_err(f"Reset failed: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Argument Parser
# ─────────────────────────────────────────────────────────────────────────────
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="main.py",
        description="Multi-Modal Biometric Proctoring System",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py --register student_01
  python main.py --start-exam student_01
  python main.py --start-exam student_01 --interval 20
  python main.py --list-users
  python main.py --reset-user student_01
        """,
    )

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--register",   metavar="USER_ID",
                       help="Enrol a new user (captures face + voice).")
    group.add_argument("--start-exam", metavar="USER_ID",
                       help="Verify identity & begin proctored exam session.")
    group.add_argument("--list-users", action="store_true",
                       help="List all enrolled users.")
    group.add_argument("--reset-user", metavar="USER_ID",
                       help="Delete a user's stored biometric data.")

    parser.add_argument(
        "--interval", type=int, default=30,
        help="Heartbeat check interval in seconds (default: 30). Used with --start-exam.",
    )
    parser.add_argument(
        "--db-path", type=str, default="./proctor_db",
        help="Path to the ChromaDB persistent store (default: ./proctor_db).",
    )
    parser.add_argument(
        "--log-file", type=str, default=LOG_FILE,
        help=f"Path to the JSON event log (default: {LOG_FILE}).",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Enable DEBUG-level logging.",
    )
    return parser


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main():
    print(BANNER)
    parser = build_parser()
    args   = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # ── Bootstrap ExamProctor ─────────────────────────────────────────────────
    try:
        proctor = ExamProctor(log_file=args.log_file, db_path=args.db_path)
    except Exception as e:
        _print_err(f"Failed to initialise proctoring engine: {e}")
        logger.exception("Initialisation error")
        sys.exit(1)

    # ── Dispatch ──────────────────────────────────────────────────────────────
    if args.register:
        cmd_register(proctor, args.register)

    elif args.start_exam:
        if args.interval < 5:
            _print_warn("Interval below 5s is not recommended. Setting to 10s.")
            args.interval = 10
        cmd_start_exam(proctor, args.start_exam, args.interval)

    elif args.list_users:
        cmd_list_users(proctor)

    elif args.reset_user:
        cmd_reset_user(proctor, args.reset_user)


if __name__ == "__main__":
    main()
