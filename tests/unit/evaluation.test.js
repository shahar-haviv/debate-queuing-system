/**
 * The Personal Interview rubric.
 *
 * The Hebrew in `evaluation.js` is the club's questionnaire, not UI copy: if a
 * word changes here nobody notices until an interviewer reads a subtly different
 * question mid-interview. So the assertions below are the *literal* strings, in
 * order, rather than regexes or "contains the word דיבייט".
 *
 * The rest of the file covers the parts that are logic: which fields are
 * mandatory, what a blank answer becomes in the saved JSONB, and that a
 * half-filled form cannot be submitted.
 */
import { describe, expect, it } from 'vitest'
import {
  PERSONAL_INTERVIEW,
  PERSONAL_INTERVIEW_FORM,
  REQUIRED_MESSAGE,
  NUMBER_MESSAGE,
  SCALE_MESSAGE,
  answersFromScores,
  buildScores,
  emptyAnswers,
  flattenQuestions,
  initialAnswers,
  problemMap,
  questionFor,
  recapRows,
  validateAnswers,
} from '../../src/lib/evaluation.js'

/* ------------------------------ the wording ------------------------------ */

const LABELS = [
  // Part 1 — general details
  'מי מראיין?',
  'שם מלא של המועמד',
  'מגדר',
  'מספר מרואיין',
  'גיל',
  'מסלול לימודים',
  'שנים שנותרו לתואר',
  'האם יש לך ניסיון קודם בדיבייט/דוברות/רטוריקה/הדרכה',
  'הקורס מתקיים בימי שני, בין השעות 17:30 ועד 21:00. האם יש איזה שהן התנגשויות שיכולות להיות לך? (קורסים מתנגשים, התנדבויות, מילואים..)',
  'למה אתה רוצה להיות במועדון הדיבייט?',
  // Part 2 — the three criteria
  'ספר לנו קצת על עצמך',
  'מה אתם עושים בזמנכם הפנוי, האם אתם עובדים ובמה',
  'ספרו על משהו אקטואלי ומעניין שקרה לאחרונה שלא קשור למלחמה בארץ או בעולם',
  'דיבייט עוסק בנושאים רבים - ביניהם היסטוריה, פילוסופיה, כלכלה, משפטים, טכנולוגיה ופוליטיקה. האם אחד הנושאים האלה מעניינים אותך?',
  "איך את.ה בעבודת צוות? (תארו מקרה, תיאור כללי, וכו')",
  'איך את.ה מתמודד.ת עם הפסד? תתאר.י מקרה שהיה לכם',
  'איך רמת האנגלית שלך?',
  // Part 3 — commitment
  'האם אתם רואים את עצמכם נשארים במועדון לאורך השנים, מתנדבים באירועים של המועדון, עוזרים לדורות הבאים להשתלב, וכו׳?',
  // Part 4 — the rating
  'זמינות ומחוייבות',
  'וייב של בן אדם והתאמה למועדון',
  'תחרויותיות ויחס להפסד',
  'מלל חופש של המראיין',
]

describe('the rubric wording', () => {
  it('asks exactly the questions the club wrote, in that order', () => {
    expect(flattenQuestions(PERSONAL_INTERVIEW_FORM).map((question) => question.label)).toEqual(LABELS)
  })

  it('carries the interviewers\' notes on the questions that have them', () => {
    expect(questionFor('years_remaining').hint).toBe(
      'שימו לב - שנים שנותרו לתואר. לא לשאול באיזו שנה הם, אלא כמה שנים נשארו באוניברסיטה.',
    )
    expect(questionFor('monday_conflicts').hint).toBe('אם יש התנגשות לכתוב מה ההתנגשות!')
    expect(questionFor('why_debate_club').hint).toBe("אם הוא לא בשנה א', לשאול למה הוא לא הגיע למועדון לפני זה")
    expect(questionFor('free_time_work').hint).toBe(
      'ספציפית להבין - האם עובדים? במה עובדים? למשל - אם הם פותחים עכשיו סטארטאפ או שהם עם עבודה מאוד עמוסה, אין להם זמן בשבילנו.',
    )
    expect(questionFor('current_affairs').hint).toBe(
      'שאלות עוקבות למראיין: איך קראת על זה? למה זה מעניין אותך? למה זה קרה לדעתך? מה היה קורה אם X היה קורה במקום?',
    )
    expect(questionFor('teamwork').hint).toBe('הערה למראיינים - אפשר לבקש מקרה ספציפי אם עולה לכם חשש')
    expect(questionFor('handling_loss').hint).toBe(
      'המטרה לבדוק אם הם תחרותיים בצורה דורסנית / יתקשו להתמודד עם משוב של שופטים. שימו לב: זו שאלה אופציונלית תלוי בתשובה בשאלה הקודמת ובכמה אתם עומדים בזמנים',
    )
    expect(questionFor('english_level').hint).toBe(
      'חשוב להבהיר כאן שלא מדובר בתנאי סף, אבל כאחד מהמון פקטורים. יש מקום לאנשים בדיבייט שלא מדברים אנגלית כלל, אך אנחנו צריכים איזון כלשהו. שלא יילחצו מזה',
    )
    expect(questionFor('long_term_commitment').hint).toBe(
      'המטרה כאן היא לבדוק שהמרואיינים רציניים ומתכוונים להגיע לקורס גם אחרי. אפשר לשאול על מחויבות למסגרות שונות. נסו להבין אם מורחים אתכם. תסבירו שאנחנו מחפשים אנשים שישארו במועדון לטווח הארוך',
    )
    expect(questionFor('interviewer_notes').hint).toBe(
      'כאן אתם יכולים לסכם את הראיון ולכתוב מה דעתכם ומידת התאמה',
    )
  })

  it('names the part-2 and part-4 headers exactly, and nothing else', () => {
    const intros = PERSONAL_INTERVIEW_FORM.map((section) => section.intro)
    expect(intros[1]).toBe(
      'חלק זה נועד לבדוק את המרואיינים בהתאם ל-3 קריטריונים שונים: ידע כללי, רמת מקצועיות, חברתי.',
    )
    expect(intros[3]).toBe('את החלק הזה אתם עושים אחרי שהמרואיין יצא מהחדר.')
    expect(intros[0]).toBeNull()
    expect(intros[2]).toBeNull()
  })

  it('is split into the four parts, in order', () => {
    expect(PERSONAL_INTERVIEW_FORM.map((section) => section.id)).toEqual([
      'details',
      'metrics',
      'commitment',
      'rating',
    ])
    expect(PERSONAL_INTERVIEW_FORM.map((section) => section.questions.length)).toEqual([10, 7, 1, 4])
  })

  it('anchors each 1 and 5 rating at the words the club chose', () => {
    expect(questionFor('rating_availability').scaleLabels).toEqual({
      1: 'לא פנוי בכלל בימי שני ו/או נראה שיפסיק להגיע תוך שני מפגשים',
      5: 'צהוב, יגיע להכל, יישאר מלא, ופנוי לגמרי בשעות הרלוונטיות',
    })
    expect(questionFor('rating_vibe').scaleLabels).toEqual({
      1: 'אקטיבית יעשה נזק למועדון, לא נעים, כנראה פסיכופט',
      5: 'הייתי יושב איתו.ה לבירה, אחלה שיחות, אדם וייבז',
    })
    expect(questionFor('rating_competitiveness').scaleLabels).toEqual({
      1: 'לא מעוניין להתחרות ולא מוכן לקבל ביקורת',
      5: 'רוצה לנצח, לוקח הפסדים כמו מוטיבציה להמשיך להשתפר',
    })
  })

  it('files the rubric under the Personal Interview task', () => {
    expect(PERSONAL_INTERVIEW).toBe('Personal Interview')
  })
})

/* ------------------------------- the fields ------------------------------ */

describe('question types', () => {
  const byKey = (key) => questionFor(key)

  it('matches each question to the input the club asked for', () => {
    expect(byKey('interviewer_name').type).toBe('text')
    expect(byKey('candidate_name').type).toBe('text')
    expect(byKey('gender').type).toBe('text')
    expect(byKey('candidate_number').type).toBe('text')
    expect(byKey('age').type).toBe('number')
    expect(byKey('study_track').type).toBe('text')
    expect(byKey('years_remaining').type).toBe('number')
    expect(byKey('prior_experience').type).toBe('text')
    expect(byKey('monday_conflicts').type).toBe('textarea')
    expect(byKey('why_debate_club').type).toBe('textarea')
    expect(byKey('tell_about_yourself').type).toBe('textarea')
    expect(byKey('rating_availability').type).toBe('scale')
    expect(byKey('interviewer_notes').type).toBe('textarea')
  })

  it('keeps exactly the questions the club marked as mandatory', () => {
    const required = flattenQuestions(PERSONAL_INTERVIEW_FORM)
      .filter((question) => question.required)
      .map((question) => question.key)

    expect(required).toEqual([
      'interviewer_name',
      'candidate_name',
      'candidate_number',
      'study_track',
      'years_remaining',
      'prior_experience',
      'monday_conflicts',
      'why_debate_club',
      'tell_about_yourself',
      'free_time_work',
      'rating_availability',
      'rating_vibe',
    ])
  })

  it('leaves the two optional ratings and the free-text closing question optional', () => {
    expect(questionFor('rating_competitiveness').required).toBe(false)
    expect(questionFor('interviewer_notes').required).toBe(false)
    expect(questionFor('gender').required).toBe(false)
    expect(questionFor('age').required).toBe(false)
  })
})

/* -------------------------------- prefill -------------------------------- */

describe('pre-filling from the board', () => {
  const candidate = { id: 'c1', name: 'Dana Cohen', serial_number: '1042' }

  it('copies the name and serial number the board already knows', () => {
    const answers = initialAnswers(candidate, { interviewers: [] })

    expect(answers.candidate_name).toBe('Dana Cohen')
    expect(answers.candidate_number).toBe('1042')
  })

  it('fills in the interviewer only when the room names exactly one', () => {
    expect(initialAnswers(candidate, { interviewers: [{ name: 'Romi' }] }).interviewer_name).toBe('Romi')
    // Two names is no answer: guessing one of them would put a wrong name on the
    // record, which is worse than leaving it for the interviewer to type.
    expect(
      initialAnswers(candidate, { interviewers: [{ name: 'Romi' }, { name: 'Yael' }] }).interviewer_name,
    ).toBe('')
    expect(initialAnswers(candidate, { interviewers: [] }).interviewer_name).toBe('')
  })

  it('survives a candidate with nothing filled in, and never invents an answer', () => {
    const answers = initialAnswers({ id: 'c2', name: 'No Serial' }, {})

    expect(answers.candidate_number).toBe('')
    expect(answers.candidate_name).toBe('No Serial')
    // Exactly the questions, all blank except the two prefills.
    expect(Object.keys(answers)).toHaveLength(flattenQuestions(PERSONAL_INTERVIEW_FORM).length)
    expect(Object.values(answers).filter((value) => value !== '').sort()).toEqual(['No Serial'])
  })

  it('starts every question blank', () => {
    expect(Object.values(emptyAnswers()).every((value) => value === '')).toBe(true)
  })
})

/* ------------------------------ validation ------------------------------- */

describe('validation', () => {
  /** A form that passes, so each case can break exactly one thing. */
  const complete = {
    ...emptyAnswers(),
    interviewer_name: 'Romi',
    candidate_name: 'Dana Cohen',
    candidate_number: '1042',
    study_track: 'Law',
    years_remaining: '2',
    prior_experience: 'none',
    monday_conflicts: 'no',
    why_debate_club: 'because',
    tell_about_yourself: 'hello',
    free_time_work: 'work',
    rating_availability: '4',
    rating_vibe: '5',
  }

  it('accepts a form with every mandatory question answered', () => {
    expect(validateAnswers(PERSONAL_INTERVIEW_FORM, complete)).toEqual([])
  })

  it('names the missing mandatory fields, in the form\'s own order', () => {
    const problems = validateAnswers(PERSONAL_INTERVIEW_FORM, {
      ...emptyAnswers(),
      interviewer_name: 'Romi',
      // candidate_name and candidate_number left blank
      study_track: '',
    })

    expect(problems.map((problem) => problem.key)).toEqual([
      'candidate_name',
      'candidate_number',
      'study_track',
      'years_remaining',
      'prior_experience',
      'monday_conflicts',
      'why_debate_club',
      'tell_about_yourself',
      'free_time_work',
      'rating_availability',
      'rating_vibe',
    ])
    expect(problems.every((problem) => problem.message === REQUIRED_MESSAGE)).toBe(true)
    // The label travels with the problem so the UI can point at the right field.
    expect(problems[0].label).toBe('שם מלא של המועמד')
  })

  it('treats whitespace as blank rather than as an answer', () => {
    const problems = validateAnswers(PERSONAL_INTERVIEW_FORM, { ...complete, study_track: '   ' })
    expect(problems.map((problem) => problem.key)).toEqual(['study_track'])
  })

  it('refuses a rating outside 1–5, including one that is not a number', () => {
    expect(validateAnswers(PERSONAL_INTERVIEW_FORM, { ...complete, rating_vibe: '6' })[0]).toMatchObject({
      key: 'rating_vibe',
      message: SCALE_MESSAGE,
    })
    expect(validateAnswers(PERSONAL_INTERVIEW_FORM, { ...complete, rating_vibe: '0' })[0].message).toBe(SCALE_MESSAGE)
    expect(validateAnswers(PERSONAL_INTERVIEW_FORM, { ...complete, rating_vibe: 'great' })[0].message).toBe(
      SCALE_MESSAGE,
    )
  })

  it('refuses a non-numeric age or year count', () => {
    expect(validateAnswers(PERSONAL_INTERVIEW_FORM, { ...complete, age: 'twenty' })[0]).toMatchObject({
      key: 'age',
      message: NUMBER_MESSAGE,
    })
    expect(validateAnswers(PERSONAL_INTERVIEW_FORM, { ...complete, years_remaining: '2.5.1' })[0].message).toBe(
      NUMBER_MESSAGE,
    )
    // A decimal is fine — "1.5 years left" is a real answer.
    expect(validateAnswers(PERSONAL_INTERVIEW_FORM, { ...complete, years_remaining: '1.5' })).toEqual([])
  })

  it('ignores a blank optional field even when it is numeric', () => {
    expect(validateAnswers(PERSONAL_INTERVIEW_FORM, { ...complete, age: '', rating_competitiveness: '' })).toEqual([])
  })

  it('keys the problems for the UI to paint per field', () => {
    const map = problemMap(validateAnswers(PERSONAL_INTERVIEW_FORM, emptyAnswers()))
    expect(map.study_track).toBe(REQUIRED_MESSAGE)
    expect(map.rating_vibe).toBe(REQUIRED_MESSAGE)
    expect(map.age).toBeUndefined()
  })
})

/* -------------------------------- payload -------------------------------- */

describe('the saved scores', () => {
  it('stores numbers as numbers and text as trimmed text', () => {
    const scores = buildScores(PERSONAL_INTERVIEW_FORM, {
      interviewer_name: '  Romi  ',
      candidate_name: 'Dana Cohen',
      age: '21',
      years_remaining: '2',
      rating_availability: '4',
      why_debate_club: '  because I like it  ',
    })

    expect(scores.interviewer_name).toBe('Romi')
    expect(scores.age).toBe(21)
    expect(scores.years_remaining).toBe(2)
    expect(scores.rating_availability).toBe(4)
    expect(scores.why_debate_club).toBe('because I like it')
  })

  it('records every question, with null for the ones left blank', () => {
    const scores = buildScores(PERSONAL_INTERVIEW_FORM, emptyAnswers())

    expect(Object.keys(scores)).toHaveLength(flattenQuestions(PERSONAL_INTERVIEW_FORM).length)
    expect(Object.values(scores).every((value) => value === null)).toBe(true)
    // The shape never depends on how far down the form the interviewer got —
    // which is what makes a later report over this JSONB predictable.
    expect(scores.rating_competitiveness).toBeNull()
  })

  it('round-trips back into the form for editing', () => {
    const scores = buildScores(PERSONAL_INTERVIEW_FORM, {
      candidate_name: 'Dana Cohen',
      age: '21',
      rating_vibe: '5',
    })

    const answers = answersFromScores(PERSONAL_INTERVIEW_FORM, scores)
    expect(answers.candidate_name).toBe('Dana Cohen')
    expect(answers.age).toBe('21')
    expect(answers.rating_vibe).toBe('5')
    expect(answers.gender).toBe('')
  })

  it('reads a blank back as a blank, not the string "null"', () => {
    expect(answersFromScores(PERSONAL_INTERVIEW_FORM, { age: null }).age).toBe('')
  })
})

/* --------------------------------- recap --------------------------------- */

describe('the read-only recap', () => {
  it('shows every question with its answer, and flags what was skipped', () => {
    const scores = buildScores(PERSONAL_INTERVIEW_FORM, {
      candidate_name: 'Dana Cohen',
      rating_availability: '4',
    })
    const rows = recapRows(PERSONAL_INTERVIEW_FORM, scores)

    expect(rows.map((section) => section.id)).toEqual(['details', 'metrics', 'commitment', 'rating'])

    const flattened = rows.flatMap((section) => section.rows)
    expect(flattened).toHaveLength(flattenQuestions(PERSONAL_INTERVIEW_FORM).length)

    const name = flattened.find((row) => row.key === 'candidate_name')
    expect(name.answer).toBe('Dana Cohen')
    expect(name.blank).toBe(false)

    const availability = flattened.find((row) => row.key === 'rating_availability')
    expect(availability.answer).toBe('4')

    const skipped = flattened.find((row) => row.key === 'english_level')
    expect(skipped.blank).toBe(true)
    expect(skipped.answer).toBe('')
  })

  it('knows a rating of 1 is an answer, not a blank', () => {
    const rows = recapRows(PERSONAL_INTERVIEW_FORM, { rating_vibe: 1 }).flatMap((section) => section.rows)
    expect(rows.find((row) => row.key === 'rating_vibe')).toMatchObject({ answer: '1', blank: false })
  })
})
