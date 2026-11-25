/**
 * Strings of "change the type of a found value" (WLojek/DocCloak#5): the menu on a row of the list
 * and on a marked place of the source text. The names of the types themselves are t.entityLabels.
 * The interface calls a category a "type" everywhere (the column of the list, the filter), and each
 * language keeps its own word for redacting.
 */
import type { FeatureStrings } from './index.ts';

export interface RetypeStrings {
  /** Heading of the menu, over the value it is about. */
  heading: string;
  /** Name of the way in on a row of the list: what it does, the type now, the value. */
  change: (type: string, value: string) => string;
  /** Under the value when it stands in several places: the choice reaches all of them. */
  scope: (places: number) => string;
  /** The last choice of the menu, apart from the types: leave the value readable. */
  keep: string;
  /** Said after the type of a value was changed. */
  changedToast: (type: string, places: number) => string;
  /** Added to the tooltip of a marked place in the source text. */
  markHint: string;
}

export const retypeStrings: FeatureStrings<RetypeStrings> = {
  en: {
    heading: 'Change type',
    change: (type, value) => `Change type (${type}): ${value}`,
    scope: (places) => `Applies to all ${places} places`,
    keep: "Don't redact",
    changedToast: (type, places) => (places === 1 ? `Type changed to "${type}"` : `Type changed to "${type}" in ${places} places`),
    markHint: 'Right-click to change the type',
  },
  pl: {
    heading: 'Zmień typ',
    change: (type, value) => `Zmień typ (${type}): ${value}`,
    scope: (places) => `Dotyczy wszystkich miejsc: ${places}`,
    keep: 'Nie anonimizuj',
    changedToast: (type, places) => (places === 1 ? `Zmieniono typ na „${type}”` : `Zmieniono typ na „${type}”. Miejsca: ${places}`),
    markHint: 'Kliknij prawym przyciskiem, aby zmienić typ',
  },
  de: {
    heading: 'Typ ändern',
    change: (type, value) => `Typ ändern (${type}): ${value}`,
    scope: (places) => `Gilt für alle ${places} Stellen`,
    keep: 'Nicht schwärzen',
    changedToast: (type, places) => (places === 1 ? `Typ geändert zu „${type}“` : `Typ an ${places} Stellen geändert zu „${type}“`),
    markHint: 'Rechtsklick, um den Typ zu ändern',
  },
  fr: {
    heading: 'Changer le type',
    change: (type, value) => `Changer le type (${type}) : ${value}`,
    scope: (places) => `S'applique aux ${places} endroits`,
    keep: 'Ne pas censurer',
    changedToast: (type, places) => (places === 1 ? `Type changé en « ${type} »` : `Type changé en « ${type} » à ${places} endroits`),
    markHint: 'Clic droit pour changer le type',
  },
  es: {
    heading: 'Cambiar el tipo',
    change: (type, value) => `Cambiar el tipo (${type}): ${value}`,
    scope: (places) => `Se aplica a los ${places} lugares`,
    keep: 'No redactar',
    changedToast: (type, places) => (places === 1 ? `Tipo cambiado a "${type}"` : `Tipo cambiado a "${type}" en ${places} lugares`),
    markHint: 'Clic derecho para cambiar el tipo',
  },
  pt: {
    heading: 'Alterar o tipo',
    change: (type, value) => `Alterar o tipo (${type}): ${value}`,
    scope: (places) => `Aplica-se aos ${places} locais`,
    keep: 'Não redigir',
    changedToast: (type, places) => (places === 1 ? `Tipo alterado para "${type}"` : `Tipo alterado para "${type}" em ${places} locais`),
    markHint: 'Clique com o botão direito para alterar o tipo',
  },
  sv: {
    heading: 'Ändra typ',
    change: (type, value) => `Ändra typ (${type}): ${value}`,
    scope: (places) => `Gäller alla ${places} ställen`,
    keep: 'Maskera inte',
    changedToast: (type, places) => (places === 1 ? `Typen ändrades till "${type}"` : `Typen ändrades till "${type}" på ${places} ställen`),
    markHint: 'Högerklicka för att ändra typ',
  },
  no: {
    heading: 'Endre type',
    change: (type, value) => `Endre type (${type}): ${value}`,
    scope: (places) => `Gjelder alle ${places} stedene`,
    keep: 'Ikke maskér',
    changedToast: (type, places) => (places === 1 ? `Typen ble endret til «${type}»` : `Typen ble endret til «${type}» på ${places} steder`),
    markHint: 'Høyreklikk for å endre type',
  },
};
