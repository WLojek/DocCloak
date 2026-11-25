/**
 * Strings of a refused export that names what it found (T288): added to the refusal the writer's
 * own check gives ("found a trace of the original data"), so the user knows which value it was
 * and what to do about it.
 */
import type { FeatureStrings } from './index.ts';

export interface ExportRefusalStrings {
  /** After the refusal: the values found again (already in quotes) and the way out. */
  traceValues: (values: string, count: number) => string;
}

export const exportRefusalStrings: FeatureStrings<ExportRefusalStrings> = {
  en: {
    traceValues: (values, count) => (count === 1
      ? `Found again in the file: ${values}. It may stand inside another word, or in a part of the file DocCloak cannot change. Untick this value in the list to keep it visible, or mark the whole word it belongs to, then download again.`
      : `Found again in the file: ${values}. They may stand inside other words, or in a part of the file DocCloak cannot change. Untick these values in the list to keep them visible, or mark the whole words they belong to, then download again.`),
  },
  pl: {
    traceValues: (values, count) => (count === 1
      ? `Znaleziono ponownie w pliku: ${values}. Może to być część innego słowa albo miejsce w pliku, którego DocCloak nie może zmienić. Odznacz tę wartość na liście, aby została widoczna, albo zaznacz całe słowo, do którego należy, i pobierz ponownie.`
      : `Znaleziono ponownie w pliku: ${values}. Mogą to być części innych słów albo miejsca w pliku, których DocCloak nie może zmienić. Odznacz te wartości na liście, aby zostały widoczne, albo zaznacz całe słowa, do których należą, i pobierz ponownie.`),
  },
  de: {
    traceValues: (values, count) => (count === 1
      ? `Erneut in der Datei gefunden: ${values}. Der Wert kann in einem anderen Wort stehen oder in einem Teil der Datei, den DocCloak nicht ändern kann. Entfernen Sie das Häkchen bei diesem Wert in der Liste, damit er sichtbar bleibt, oder markieren Sie das ganze Wort, zu dem er gehört, und laden Sie erneut herunter.`
      : `Erneut in der Datei gefunden: ${values}. Die Werte können in anderen Wörtern stehen oder in einem Teil der Datei, den DocCloak nicht ändern kann. Entfernen Sie die Häkchen bei diesen Werten in der Liste, damit sie sichtbar bleiben, oder markieren Sie die ganzen Wörter, zu denen sie gehören, und laden Sie erneut herunter.`),
  },
  fr: {
    traceValues: (values, count) => (count === 1
      ? `Retrouvé dans le fichier : ${values}. Cette valeur peut se trouver dans un autre mot, ou dans une partie du fichier que DocCloak ne peut pas modifier. Décochez-la dans la liste pour la laisser visible, ou marquez le mot entier auquel elle appartient, puis téléchargez à nouveau.`
      : `Retrouvé dans le fichier : ${values}. Ces valeurs peuvent se trouver dans d'autres mots, ou dans une partie du fichier que DocCloak ne peut pas modifier. Décochez-les dans la liste pour les laisser visibles, ou marquez les mots entiers auxquels elles appartiennent, puis téléchargez à nouveau.`),
  },
  es: {
    traceValues: (values, count) => (count === 1
      ? `Encontrado de nuevo en el archivo: ${values}. Puede estar dentro de otra palabra o en una parte del archivo que DocCloak no puede cambiar. Desmarque este valor en la lista para dejarlo visible, o marque la palabra entera a la que pertenece, y descargue de nuevo.`
      : `Encontrados de nuevo en el archivo: ${values}. Pueden estar dentro de otras palabras o en una parte del archivo que DocCloak no puede cambiar. Desmarque estos valores en la lista para dejarlos visibles, o marque las palabras enteras a las que pertenecen, y descargue de nuevo.`),
  },
  pt: {
    traceValues: (values, count) => (count === 1
      ? `Encontrado de novo no ficheiro: ${values}. Pode estar dentro de outra palavra ou numa parte do ficheiro que o DocCloak não consegue alterar. Desmarque este valor na lista para o deixar visível, ou marque a palavra inteira a que pertence, e transfira de novo.`
      : `Encontrados de novo no ficheiro: ${values}. Podem estar dentro de outras palavras ou numa parte do ficheiro que o DocCloak não consegue alterar. Desmarque estes valores na lista para os deixar visíveis, ou marque as palavras inteiras a que pertencem, e transfira de novo.`),
  },
  sv: {
    traceValues: (values, count) => (count === 1
      ? `Hittades igen i filen: ${values}. Värdet kan stå inuti ett annat ord eller i en del av filen som DocCloak inte kan ändra. Avmarkera värdet i listan så att det förblir synligt, eller markera hela ordet som det hör till, och ladda ner igen.`
      : `Hittades igen i filen: ${values}. Värdena kan stå inuti andra ord eller i en del av filen som DocCloak inte kan ändra. Avmarkera värdena i listan så att de förblir synliga, eller markera hela orden som de hör till, och ladda ner igen.`),
  },
  no: {
    traceValues: (values, count) => (count === 1
      ? `Funnet igjen i filen: ${values}. Verdien kan stå inne i et annet ord eller i en del av filen som DocCloak ikke kan endre. Fjern avkrysningen for verdien i listen slik at den forblir synlig, eller marker hele ordet den hører til, og last ned på nytt.`
      : `Funnet igjen i filen: ${values}. Verdiene kan stå inne i andre ord eller i en del av filen som DocCloak ikke kan endre. Fjern avkrysningen for verdiene i listen slik at de forblir synlige, eller marker hele ordene de hører til, og last ned på nytt.`),
  },
};
