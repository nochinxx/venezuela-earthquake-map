"""
guardrails.py — Fake news / quality filters applied before any report hits the DB.

Import: from guardrails import is_credible, cap_damage
"""

# Sensationalist / known-bot patterns that trigger rejection
FAKE_PATTERNS = [
    "100,000 feared dead",
    "100000 feared dead",
    "extinction level",
    "end of the world",
    "planet x",
    "nibiru",
    "haarp",
    "engineered earthquake",
    "artificial earthquake",
    "government caused",
    "terremoto artificial",
    "mkultra",
    "illuminati",
]

# Accounts with a track record of disinfo — skip their content entirely
BLOCKED_ACCOUNTS = {
    "daily netizen",        # "100,000 FEARED DEAD" sensationalism
    "singularitymatthew",
    "conspiracyhub",
}

# Minimum keywords required to confirm Venezuela earthquake relevance
VENEZUELA_KEYWORDS = [
    "venezuela", "venezolano", "venezuelan",
    "yumare", "carabobo", "caracas", "valencia", "yaracuy",
    "san felipe", "la guaira", "san bernardino",
    "funvisis", "temblor", "sismo", "terremoto",
]


def is_credible(text: str, author: str = "") -> tuple[bool, str]:
    """
    Returns (True, "") if content passes all guardrails.
    Returns (False, reason) if it should be rejected.
    """
    t = text.lower()
    a = (author or "").lower().replace("@", "")

    # Block known disinfo accounts
    for blocked in BLOCKED_ACCOUNTS:
        if blocked in a:
            return False, f"blocked account: {author}"

    # Reject sensationalist fake patterns
    for pattern in FAKE_PATTERNS:
        if pattern in t:
            return False, f"fake pattern: '{pattern}'"

    # Must mention Venezuela or a known affected area
    if not any(kw in t for kw in VENEZUELA_KEYWORDS):
        return False, "no Venezuela keyword found"

    return True, ""


def cap_damage(damage_level: int, source: str, author: str = "") -> int:
    """
    Cap damage claims at 4 for unknown sources.
    Only well-known verified accounts can claim level 5 (collapse).
    """
    VERIFIED_FOR_COLLAPSE = {
        "davidplacer", "usembassyve", "cruzrojavlj", "apnews", "ap",
        "reuters", "cnneespanol", "cnn", "funvisis", "vtv_vzla",
        "convzlacomando", "mariacorinya", "carlaangola",
    }
    if damage_level == 5:
        a = (author or "").lower().replace("@", "")
        if not any(v in a for v in VERIFIED_FOR_COLLAPSE):
            return 4  # downgrade unverified collapse claims
    return damage_level
