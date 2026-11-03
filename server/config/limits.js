// Central place for business rules and input limits (keeps controllers and tests in sync).
export const LIMITS = Object.freeze({
    CREDITS_PER_INTERVIEW: 50,
    MAX_ANSWER_CHARS: 3000,
    MAX_RESUME_CHARS: 15000,
    MAX_RESUME_PAGES: 10,
    MAX_FIELD_CHARS: 100,
    MAX_LIST_ITEMS: 20,
})
