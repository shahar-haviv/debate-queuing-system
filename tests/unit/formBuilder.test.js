/**
 * Pure domain tests for the Back Office Form Builder & extended question types.
 */
import { describe, expect, it } from 'vitest'
import {
  DEBATE_INTERVIEW_FORM,
  PERSONAL_INTERVIEW_FORM,
  SELECT_MESSAGE,
  buildScores,
  flattenQuestions,
  formatMultiSelect,
  parseMultiSelect,
  recapRows,
  validateAnswers,
} from '../../src/domain/evaluation'
import {
  BUILT_IN_TEMPLATES,
  addQuestion,
  addSection,
  defaultDebateFormConfig,
  defaultPersonalFormConfig,
  duplicateQuestion,
  moveQuestion,
  moveSection,
  normalizeEventForms,
  removeQuestion,
  removeSection,
  resolveTaskFormConfig,
  updateQuestion,
  updateSection,
  validateFormConfig,
} from '../../src/domain/formBuilder'

describe('formBuilder — templates and defaults', () => {
  it('provides built-in templates for both Personal and Debate interviews', () => {
    expect(BUILT_IN_TEMPLATES.length).toBeGreaterThanOrEqual(4)
    expect(BUILT_IN_TEMPLATES.some((t) => t.task === 'Personal Interview')).toBe(true)
    expect(BUILT_IN_TEMPLATES.some((t) => t.task === 'Debate Interview')).toBe(true)
  })

  it('defaults Personal Interview to enabled with the 22-question rubric, and Debate to disabled until opted in', () => {
    const personal = resolveTaskFormConfig(undefined, 'Personal Interview')
    const debate = resolveTaskFormConfig(undefined, 'Debate Interview')

    expect(personal.enabled).toBe(true)
    expect(flattenQuestions(personal.sections)).toHaveLength(flattenQuestions(PERSONAL_INTERVIEW_FORM).length)

    expect(debate.enabled).toBe(false)
    expect(flattenQuestions(debate.sections)).toHaveLength(flattenQuestions(DEBATE_INTERVIEW_FORM).length)
  })

  it('normalizes and resolves per-event form overrides', () => {
    const raw = {
      'Debate Interview': {
        enabled: true,
        title: 'Custom Debate Rubric',
        direction: 'ltr',
        submitLabel: 'Submit Debate Score',
        skipLabel: 'Skip',
        sections: [
          {
            id: 's1',
            part: 'Part 1',
            heading: 'Clash',
            intro: null,
            questions: [{ key: 'rating_clash', label: 'Clash Score', type: 'scale', required: true, scaleMin: 1, scaleMax: 10 }],
          },
        ],
      },
    }

    const normalized = normalizeEventForms(raw)
    const debate = resolveTaskFormConfig(normalized, 'Debate Interview')

    expect(debate.enabled).toBe(true)
    expect(debate.direction).toBe('ltr')
    expect(debate.title).toBe('Custom Debate Rubric')
    expect(debate.sections[0].questions[0]).toMatchObject({
      key: 'rating_clash',
      type: 'scale',
      scaleMin: 1,
      scaleMax: 10,
    })
  })
})

describe('formBuilder — section and question mutations', () => {
  it('adds, updates, reorders and removes sections cleanly', () => {
    let config = defaultPersonalFormConfig()
    const initialCount = config.sections.length

    config = addSection(config, { part: 'חלק 5', heading: 'סיום' })
    expect(config.sections).toHaveLength(initialCount + 1)
    const addedId = config.sections[config.sections.length - 1].id

    config = updateSection(config, addedId, { heading: 'סיכום מראיין', intro: 'הערה חשובה' })
    expect(config.sections[config.sections.length - 1].heading).toBe('סיכום מראיין')
    expect(config.sections[config.sections.length - 1].intro).toBe('הערה חשובה')

    config = moveSection(config, addedId, 'up')
    expect(config.sections[config.sections.length - 2].id).toBe(addedId)

    config = removeSection(config, addedId)
    expect(config.sections).toHaveLength(initialCount)
  })

  it('adds, updates, duplicates, moves and removes questions within a section', () => {
    let config = defaultDebateFormConfig(true)
    const sectionId = config.sections[0].id
    const startLen = config.sections[0].questions.length

    config = addQuestion(config, sectionId, {
      label: 'Position in Round',
      type: 'select',
      required: true,
      options: ['OG', 'OO', 'CG', 'CO'],
    })
    expect(config.sections[0].questions).toHaveLength(startLen + 1)

    const addedQuestion = config.sections[0].questions[startLen]
    expect(addedQuestion.options).toEqual(['OG', 'OO', 'CG', 'CO'])

    config = updateQuestion(config, sectionId, addedQuestion.key, {
      label: 'BP Position',
      hint: 'Pick one of the four teams',
    })
    expect(config.sections[0].questions[startLen].label).toBe('BP Position')
    expect(config.sections[0].questions[startLen].hint).toBe('Pick one of the four teams')

    config = duplicateQuestion(config, sectionId, addedQuestion.key)
    expect(config.sections[0].questions).toHaveLength(startLen + 2)
    const copyKey = config.sections[0].questions[startLen + 1].key
    expect(copyKey).not.toBe(addedQuestion.key)

    config = moveQuestion(config, sectionId, copyKey, 'up')
    expect(config.sections[0].questions[startLen].key).toBe(copyKey)

    config = removeQuestion(config, sectionId, copyKey)
    expect(config.sections[0].questions).toHaveLength(startLen + 1)
  })

  it('validates structural soundness of a form configuration', () => {
    const valid = defaultPersonalFormConfig()
    expect(validateFormConfig(valid)).toEqual([])

    const emptySections = { ...valid, sections: [] }
    expect(validateFormConfig(emptySections)[0]).toMatch(/at least one section/)

    const disabledEmpty = { ...emptySections, enabled: false }
    expect(validateFormConfig(disabledEmpty)).toEqual([])
  })
})

describe('extended question types — validation, scoring and recap', () => {
  const customForm = [
    {
      id: 'custom',
      part: 'Part 1',
      heading: 'Custom Fields',
      intro: null,
      questions: [
        {
          key: 'track_choice',
          label: 'Preferred Track',
          type: 'select',
          required: true,
          options: ['Hebrew', 'English', 'Both'],
        },
        {
          key: 'skills',
          label: 'Skills Observed',
          type: 'multiselect',
          required: false,
          options: ['Logic', 'Rhetoric', 'Teamwork'],
        },
        {
          key: 'available_mondays',
          label: 'Available on Mondays?',
          type: 'boolean',
          required: true,
        },
        {
          key: 'rating_ten',
          label: 'Speaker Score (1–10)',
          type: 'scale',
          required: true,
          scaleMin: 1,
          scaleMax: 10,
        },
      ],
    },
  ]

  it('validates custom scale bounds (1–10) and select options', () => {
    const badScale = validateAnswers(customForm, {
      track_choice: 'Hebrew',
      available_mondays: 'Yes',
      rating_ten: '11',
    })
    expect(badScale).toEqual([
      {
        key: 'rating_ten',
        label: 'Speaker Score (1–10)',
        message: 'יש לבחור ערך בין 1 ל-10',
      },
    ])

    const validTen = validateAnswers(customForm, {
      track_choice: 'Hebrew',
      available_mondays: 'Yes',
      rating_ten: '9',
    })
    expect(validTen).toEqual([])

    const invalidOption = validateAnswers(customForm, {
      track_choice: 'InvalidTrack',
      available_mondays: 'Yes',
      rating_ten: '8',
    })
    expect(invalidOption[0]).toMatchObject({
      key: 'track_choice',
      message: SELECT_MESSAGE,
    })
  })

  it('formats and parses multiselect options cleanly and stores scores', () => {
    expect(parseMultiSelect('Logic, Rhetoric, ')).toEqual(['Logic', 'Rhetoric'])
    expect(formatMultiSelect(['Logic', 'Rhetoric', 'Logic'])).toBe('Logic, Rhetoric')

    const scores = buildScores(customForm, {
      track_choice: 'Both',
      skills: formatMultiSelect(['Logic', 'Teamwork']),
      available_mondays: 'Yes',
      rating_ten: '9',
    })

    expect(scores).toEqual({
      track_choice: 'Both',
      skills: 'Logic, Teamwork',
      available_mondays: 'Yes',
      rating_ten: 9,
    })

    const recap = recapRows(customForm, { ...scores, legacy_removed_question: 'Saved earlier' })
    expect(recap).toHaveLength(2)
    expect(recap[1].id).toBe('extra_recorded_fields')
    expect(recap[1].rows[0]).toMatchObject({
      key: 'legacy_removed_question',
      answer: 'Saved earlier',
    })
  })
})
