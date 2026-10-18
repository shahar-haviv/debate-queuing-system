/**
 * The interviewer's rubric for a Personal Interview.
 *
 * The Hebrew wording in this file is *content*, not chrome — it is the exact
 * text the club's interviewers agreed on, so it is transcribed verbatim and
 * lives in one place rather than being scattered through JSX. Re-wording a
 * question, changing which fields are mandatory, or adding a note for the
 * interviewer is a one-line edit here.
 *
 * The module is deliberately pure: it describes the form, validates answers and
 * shapes the payload, but never touches the database. `EvaluationForm.jsx`
 * renders it, `RoomView.jsx` saves it, and the tests exercise it without a
 * browser — which is how the exact strings get asserted in CI instead of being
 * eyeballed once.
 *
 * `scores` on the saved row is a flat `{ key: value }` object over exactly these
 * keys, numbers for `number`/`scale` and trimmed strings otherwise. Blanks are
 * stored as `null` rather than dropped, so the JSONB mirrors the form and a
 * later "20 questions, 18 answered" report needs no schema archaeology.
 */

/** The task whose rubric this is. Matches the `task_assignment` enum. */
export const PERSONAL_INTERVIEW = 'Personal Interview'

/* Validation messages — the form is Hebrew, so the errors are too. */
export const REQUIRED_MESSAGE = 'שדה חובה'
export const NUMBER_MESSAGE = 'יש להזין מספר'
export const SCALE_MESSAGE = 'יש לבחור ערך בין 1 ל-5'

export const SCALE_MIN = 1
export const SCALE_MAX = 5

/**
 * Section headings.
 *
 * The four sections need to be visually distinct, and only two of them came
 * with intro text of their own. These eyebrows are the only strings in the form
 * that the club did not supply — they carry no instructions, and each is a
 * one-line edit if the wording should change.
 */
const PART = ['חלק 1', 'חלק 2', 'חלק 3', 'חלק 4']

/**
 * The rubric.
 *
 * `type` drives both the input and the stored value: `text`/`textarea` store a
 * string, `number` stores a number, `scale` stores an integer 1–5.
 * `prefill` names the one field the database can fill in for the interviewer.
 */
export const PERSONAL_INTERVIEW_FORM = [
  {
    id: 'details',
    part: PART[0],
    heading: 'פרטים כלליים',
    intro: null,
    questions: [
      { key: 'interviewer_name', label: 'מי מראיין?', type: 'text', required: true, prefill: 'interviewer' },
      { key: 'candidate_name', label: 'שם מלא של המועמד', type: 'text', required: true, prefill: 'name' },
      { key: 'gender', label: 'מגדר', type: 'text', required: false },
      {
        key: 'candidate_number',
        label: 'מספר מרואיין',
        type: 'text',
        required: true,
        prefill: 'serial',
      },
      { key: 'age', label: 'גיל', type: 'number', required: false },
      { key: 'study_track', label: 'מסלול לימודים', type: 'text', required: true },
      {
        key: 'years_remaining',
        label: 'שנים שנותרו לתואר',
        type: 'number',
        required: true,
        hint: 'שימו לב - שנים שנותרו לתואר. לא לשאול באיזו שנה הם, אלא כמה שנים נשארו באוניברסיטה.',
      },
      {
        key: 'prior_experience',
        label: 'האם יש לך ניסיון קודם בדיבייט/דוברות/רטוריקה/הדרכה',
        type: 'text',
        required: true,
      },
      {
        key: 'monday_conflicts',
        label:
          'הקורס מתקיים בימי שני, בין השעות 17:30 ועד 21:00. האם יש איזה שהן התנגשויות שיכולות להיות לך? (קורסים מתנגשים, התנדבויות, מילואים..)',
        type: 'textarea',
        required: true,
        hint: 'אם יש התנגשות לכתוב מה ההתנגשות!',
      },
      {
        key: 'why_debate_club',
        label: 'למה אתה רוצה להיות במועדון הדיבייט?',
        type: 'textarea',
        required: true,
        hint: "אם הוא לא בשנה א', לשאול למה הוא לא הגיע למועדון לפני זה",
      },
    ],
  },
  {
    id: 'metrics',
    part: PART[1],
    heading: null,
    intro: 'חלק זה נועד לבדוק את המרואיינים בהתאם ל-3 קריטריונים שונים: ידע כללי, רמת מקצועיות, חברתי.',
    questions: [
      { key: 'tell_about_yourself', label: 'ספר לנו קצת על עצמך', type: 'textarea', required: true },
      {
        key: 'free_time_work',
        label: 'מה אתם עושים בזמנכם הפנוי, האם אתם עובדים ובמה',
        type: 'textarea',
        required: true,
        hint: 'ספציפית להבין - האם עובדים? במה עובדים? למשל - אם הם פותחים עכשיו סטארטאפ או שהם עם עבודה מאוד עמוסה, אין להם זמן בשבילנו.',
      },
      {
        key: 'current_affairs',
        label: 'ספרו על משהו אקטואלי ומעניין שקרה לאחרונה שלא קשור למלחמה בארץ או בעולם',
        type: 'textarea',
        required: false,
        hint: 'שאלות עוקבות למראיין: איך קראת על זה? למה זה מעניין אותך? למה זה קרה לדעתך? מה היה קורה אם X היה קורה במקום?',
      },
      {
        key: 'debate_topics_interest',
        label:
          'דיבייט עוסק בנושאים רבים - ביניהם היסטוריה, פילוסופיה, כלכלה, משפטים, טכנולוגיה ופוליטיקה. האם אחד הנושאים האלה מעניינים אותך?',
        type: 'textarea',
        required: false,
        hint: 'שיח חופשי להבין ידע כללי והבנה.. שווה גם להכווין לנושאים שאולי פחות מרגישים בנוח איתם כדי לבדוק רמת ידע',
      },
      {
        key: 'teamwork',
        label: 'איך את.ה בעבודת צוות? (תארו מקרה, תיאור כללי, וכו\')',
        type: 'textarea',
        required: false,
        hint: 'הערה למראיינים - אפשר לבקש מקרה ספציפי אם עולה לכם חשש',
      },
      {
        key: 'handling_loss',
        label: 'איך את.ה מתמודד.ת עם הפסד? תתאר.י מקרה שהיה לכם',
        type: 'textarea',
        required: false,
        hint: 'המטרה לבדוק אם הם תחרותיים בצורה דורסנית / יתקשו להתמודד עם משוב של שופטים. שימו לב: זו שאלה אופציונלית תלוי בתשובה בשאלה הקודמת ובכמה אתם עומדים בזמנים',
      },
      {
        key: 'english_level',
        label: 'איך רמת האנגלית שלך?',
        type: 'textarea',
        required: false,
        hint: 'חשוב להבהיר כאן שלא מדובר בתנאי סף, אבל כאחד מהמון פקטורים. יש מקום לאנשים בדיבייט שלא מדברים אנגלית כלל, אך אנחנו צריכים איזון כלשהו. שלא יילחצו מזה',
      },
    ],
  },
  {
    id: 'commitment',
    part: PART[2],
    heading: 'מחויבות',
    intro: null,
    questions: [
      {
        key: 'long_term_commitment',
        label:
          'האם אתם רואים את עצמכם נשארים במועדון לאורך השנים, מתנדבים באירועים של המועדון, עוזרים לדורות הבאים להשתלב, וכו׳?',
        type: 'textarea',
        required: false,
        hint: 'המטרה כאן היא לבדוק שהמרואיינים רציניים ומתכוונים להגיע לקורס גם אחרי. אפשר לשאול על מחויבות למסגרות שונות. נסו להבין אם מורחים אתכם. תסבירו שאנחנו מחפשים אנשים שישארו במועדון לטווח הארוך',
      },
    ],
  },
  {
    id: 'rating',
    part: PART[3],
    heading: null,
    intro: 'את החלק הזה אתם עושים אחרי שהמרואיין יצא מהחדר.',
    questions: [
      {
        key: 'rating_availability',
        label: 'זמינות ומחוייבות',
        type: 'scale',
        required: true,
        scaleLabels: {
          1: 'לא פנוי בכלל בימי שני ו/או נראה שיפסיק להגיע תוך שני מפגשים',
          5: 'צהוב, יגיע להכל, יישאר מלא, ופנוי לגמרי בשעות הרלוונטיות',
        },
      },
      {
        key: 'rating_vibe',
        label: 'וייב של בן אדם והתאמה למועדון',
        type: 'scale',
        required: true,
        scaleLabels: {
          1: 'אקטיבית יעשה נזק למועדון, לא נעים, כנראה פסיכופט',
          5: 'הייתי יושב איתו.ה לבירה, אחלה שיחות, אדם וייבז',
        },
      },
      {
        key: 'rating_competitiveness',
        label: 'תחרויותיות ויחס להפסד',
        type: 'scale',
        required: false,
        scaleLabels: {
          1: 'לא מעוניין להתחרות ולא מוכן לקבל ביקורת',
          5: 'רוצה לנצח, לוקח הפסדים כמו מוטיבציה להמשיך להשתפר',
        },
      },
      {
        key: 'interviewer_notes',
        label: 'מלל חופש של המראיין',
        type: 'textarea',
        required: false,
        hint: 'כאן אתם יכולים לסכם את הראיון ולכתוב מה דעתכם ומידת התאמה',
      },
    ],
  },
]

/** Every question in the form, in order, with no section wrappers. */
export function flattenQuestions(form = PERSONAL_INTERVIEW_FORM) {
  return form.flatMap((section) => section.questions ?? [])
}

/** The question behind a key, or null. */
export function questionFor(key, form = PERSONAL_INTERVIEW_FORM) {
  return flattenQuestions(form).find((question) => question.key === key) ?? null
}

/** A blank answer for every question, so inputs are controlled from the start. */
export function emptyAnswers(form = PERSONAL_INTERVIEW_FORM) {
  return Object.fromEntries(flattenQuestions(form).map((question) => [question.key, '']))
}

/**
 * The blank form with the database's half already filled in.
 *
 * "מי מראיין?" is filled from the room's panel only when exactly one
 * interviewer is recorded — with a panel of two there is no way to guess which
 * one is sitting in the room, and a wrong name is worse than a blank.
 */
export function initialAnswers(candidate, room, form = PERSONAL_INTERVIEW_FORM) {
  const answers = emptyAnswers(form)
  const panel = Array.isArray(room?.interviewers) ? room.interviewers : []
  const soloInterviewer = panel.length === 1 ? String(panel[0]?.name ?? '').trim() : ''

  for (const question of flattenQuestions(form)) {
    if (question.prefill === 'interviewer') answers[question.key] = soloInterviewer
    else if (question.prefill === 'name') answers[question.key] = candidate?.name ?? ''
    else if (question.prefill === 'serial') answers[question.key] = candidate?.serial_number ?? ''
  }
  return answers
}

/** Is this text a usable number? Kept narrow on purpose — "12abc" is not. */
function isNumeric(text) {
  return /^-?\d+(\.\d+)?$/.test(text)
}

/**
 * What is missing or malformed, as `{ key, label, message }` rows.
 *
 * Blank optional fields are fine; blank required ones are not. A filled field is
 * still checked against its type, because `<input type="number">` can be pasted
 * into with anything the browser does not recognise.
 */
export function validateAnswers(form = PERSONAL_INTERVIEW_FORM, answers = {}) {
  const problems = []

  for (const question of flattenQuestions(form)) {
    const raw = answers[question.key]
    const text = raw === null || raw === undefined ? '' : String(raw).trim()

    if (!text) {
      if (question.required) {
        problems.push({ key: question.key, label: question.label, message: REQUIRED_MESSAGE })
      }
      continue
    }

    if (question.type === 'number' && !isNumeric(text)) {
      problems.push({ key: question.key, label: question.label, message: NUMBER_MESSAGE })
    }

    if (question.type === 'scale') {
      const value = Number(text)
      if (!Number.isInteger(value) || value < SCALE_MIN || value > SCALE_MAX) {
        problems.push({ key: question.key, label: question.label, message: SCALE_MESSAGE })
      }
    }
  }

  return problems
}

/** Convenience for the UI: the same problems keyed by field. */
export function problemMap(problems = []) {
  return Object.fromEntries(problems.map((problem) => [problem.key, problem.message]))
}

/**
 * The rubric answers as they are stored: numbers where the question is numeric,
 * trimmed strings otherwise, and `null` for everything left blank. Every key is
 * present, so the shape of the JSONB never depends on how far down the form the
 * interviewer got.
 */
export function buildScores(form = PERSONAL_INTERVIEW_FORM, answers = {}) {
  const scores = {}

  for (const question of flattenQuestions(form)) {
    const raw = answers[question.key]
    const text = raw === null || raw === undefined ? '' : String(raw).trim()

    if (!text) scores[question.key] = null
    else if (question.type === 'number' || question.type === 'scale') scores[question.key] = Number(text)
    else scores[question.key] = text
  }

  return scores
}

/** The reverse, for putting a saved evaluation back into the inputs. */
export function answersFromScores(form = PERSONAL_INTERVIEW_FORM, scores = {}) {
  const answers = emptyAnswers(form)
  for (const question of flattenQuestions(form)) {
    const value = scores?.[question.key]
    answers[question.key] = value === null || value === undefined ? '' : String(value)
  }
  return answers
}

/**
 * The saved answers as `{ question, answer }` rows for a read-only recap,
 * blanks included so the reviewer sees the gaps rather than guessing at them.
 */
export function recapRows(form = PERSONAL_INTERVIEW_FORM, scores = {}) {
  return form.map((section) => ({
    id: section.id,
    part: section.part,
    heading: section.heading,
    intro: section.intro,
    rows: (section.questions ?? []).map((question) => {
      const value = scores?.[question.key]
      const blank = value === null || value === undefined || String(value).trim() === ''
      return {
        key: question.key,
        label: question.label,
        answer: blank ? '' : String(value),
        blank,
        type: question.type,
      }
    }),
  }))
}
