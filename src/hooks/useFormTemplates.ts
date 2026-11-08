/**
 * Hook for managing reusable interview form templates in the Back Office.
 */
import { useCallback, useState } from 'react'
import type { FormTemplate, TaskAssignment, TaskFormConfig } from '../core/types'
import {
  deleteCustomFormTemplate,
  listFormTemplates,
  saveCustomFormTemplate,
} from '../services/formStorage'

export interface FormTemplatesState {
  templates: FormTemplate[]
  reloadTemplates: () => void
  saveTemplate: (input: {
    id?: string
    name: string
    description?: string
    task: TaskAssignment
    config: TaskFormConfig
  }) => FormTemplate
  removeTemplate: (id: string) => void
}

export function useFormTemplates(): FormTemplatesState {
  const [templates, setTemplates] = useState<FormTemplate[]>(() => listFormTemplates())

  const reloadTemplates = useCallback(() => {
    setTemplates(listFormTemplates())
  }, [])

  const saveTemplate = useCallback(
    (input: {
      id?: string
      name: string
      description?: string
      task: TaskAssignment
      config: TaskFormConfig
    }) => {
      const saved = saveCustomFormTemplate(input)
      setTemplates(listFormTemplates())
      return saved
    },
    [],
  )

  const removeTemplate = useCallback((id: string) => {
    deleteCustomFormTemplate(id)
    setTemplates(listFormTemplates())
  }, [])

  return { templates, reloadTemplates, saveTemplate, removeTemplate }
}
