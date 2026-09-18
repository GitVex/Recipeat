import { getHeader, readBody, type H3Event } from 'h3'
import { fail } from './errors.ts'

// application/json, plus vendor types such as application/vnd.api+json.
const JSON_TYPE = /^application\/([\w.+-]+\+)?json$/i

/**
 * The JSON envelope every extraction endpoint takes. What is inside it is each
 * modality's business.
 */
export async function readJsonBody(event: H3Event): Promise<unknown> {
  // The parameters after ";" (charset and friends) are not our concern.
  if (!JSON_TYPE.test((getHeader(event, 'content-type') ?? '').split(';')[0]!.trim())) {
    throw fail(415, 'Expected a JSON request body.')
  }
  try {
    // strict: true so a malformed body throws instead of arriving as a string.
    return await readBody(event, { strict: true })
  } catch (error) {
    throw fail(400, 'Request body is not valid JSON.', error)
  }
}
