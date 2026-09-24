/**
 * Welche freie Erkennung eingestellt ist -- ohne die Anbieter selbst zu
 * laden. Die Oberflaeche fragt das (soll sie "Erkennung erneut ausfuehren"
 * anbieten oder sagen, dass keine eingerichtet ist), und sie darf dafuer
 * nicht die Module der Aufbereitung in einen Request ziehen.
 */

export type FreierAnbieterName = 'ollama'

export function freierAnbieterName(): FreierAnbieterName | null {
  switch (process.env['DMS_EXTRAKTION'] ?? 'keiner') {
    case 'ollama':
      return 'ollama'
    default:
      return null
  }
}

/** Ob fuer die freie Erkennung ein Anbieter eingestellt ist. */
export function extraktionEingerichtet(): boolean {
  return freierAnbieterName() !== null
}
