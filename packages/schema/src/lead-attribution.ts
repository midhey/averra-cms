import { z } from 'zod'
import { cleanAttributionValue, UTM_MAX_LENGTH } from './lead-attribution-values'

export { ATTRIBUTION_PREFIX, UTM_KEYS, UTM_MAX_LENGTH } from './lead-attribution-values'

// Некорректная необязательная метка не должна мешать человеку отправить заявку.
const singleLine = (max: number) =>
  z
    .string()
    .transform((value) => cleanAttributionValue(value, max))
    .pipe(
      z
        .string()
        .max(max)
        .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u),
    )
    .catch('')
    .default('')

export const LeadAttribution = z.object({
  utm_source: singleLine(UTM_MAX_LENGTH),
  utm_medium: singleLine(UTM_MAX_LENGTH),
  utm_campaign: singleLine(UTM_MAX_LENGTH),
  utm_content: singleLine(UTM_MAX_LENGTH),
  utm_term: singleLine(UTM_MAX_LENGTH),
  pageUrl: singleLine(2048),
  referrerDomain: singleLine(253),
})
export type LeadAttribution = z.infer<typeof LeadAttribution>

export const LeadSummaryQuery = z.object({ days: z.enum(['7', '30', '90']).default('30') })
