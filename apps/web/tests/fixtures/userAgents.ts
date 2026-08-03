// Batería de user agents REALES, no inventados. Un solo origen para los dos criterios que rutean por
// dispositivo —la variante de precisión (`modelVariantFor`) y los presets de fuerza
// (`kataStrengthOptionsFor`)— porque el test cruzado entre ambos sólo prueba algo si los dos miran
// exactamente la misma lista: dos copias que se desincronizan darían "coinciden" sobre UA distintos.
//
// Los dos volcados del iPhone 12 Pro Max son los que motivan todo esto (el motor moría alrededor de
// la inferencia 80 en AMBOS navegadores del mismo aparato), así que sus UA exactos tienen que estar.
//
// No es un archivo de test: `vitest.config.ts` sólo colecta `tests/**/*.test.{ts,tsx}`.

export const SAFARI_IOS_26_FROZEN =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1'
export const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/150.0 Mobile/15E148 Safari/604.1'
export const SAFARI_IOS_26 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
export const IPAD_OS =
  'Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
export const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'
export const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
export const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
export const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'

/** Los ocho UA reales, móviles primero. Lo que recorre todo test que aserta sobre la batería entera. */
export const REAL_USER_AGENTS = [
  SAFARI_IOS_26_FROZEN,
  CHROME_IOS,
  SAFARI_IOS_26,
  IPAD_OS,
  CHROME_ANDROID,
  CHROME_MAC,
  SAFARI_MAC,
  CHROME_WINDOWS,
] as const
