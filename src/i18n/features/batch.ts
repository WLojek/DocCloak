/**
 * Strings of "several files at once" (WLojek/DocCloak#6): the list of the set, the line in the
 * progress views that says which file is running, and the refusals of the one table of the set.
 * A set is called by one word per language (set, zestaw, Stapel, lot, lote, grupp, gruppe), and
 * each language keeps its own word for a label and for redacting.
 */
import type { FeatureStrings } from './index.ts';
import type { BatchFileStatus } from '../../ui/batch.ts';

export interface BatchStrings {
  /** Caption of the list. */
  title: string;
  /** Next to the caption: how far the set is. */
  summary: (analysed: number, total: number) => string;
  addFiles: string;
  /** Takes every file of the set off the page. */
  clearSet: string;
  /** Name of the button that takes one file out of the set. */
  remove: (name: string) => string;
  status: Record<BatchFileStatus, string>;
  /** After the status of an analysed file. */
  found: (places: number) => string;
  /** In the progress views and in the tab title: which file is running. */
  fileOf: (index: number, total: number, name: string) => string;
  /** Title of the progress view while a file is read (the analysis has its own). */
  readingTitle: string;
  /** After Cancel: what is left. */
  stopped: (waiting: number) => string;
  resume: string;
  /** The files wait for the model (not downloaded yet, or still loading). */
  waitingForModel: string;
  /** More files than the set may hold were chosen. */
  capReached: (max: number, left: number) => string;
  /** One table cannot hold the set: said instead of saving or restoring with pairs missing. */
  tooManyPairs: (max: string) => string;
  /** One label, two values, two files. */
  tableConflict: string;
  /** A file that could not be read, when the reader gave no reason of its own. */
  failedFallback: string;
  /** The analysis of a file failed; `button` is the name of the Redact button. */
  detectionFailed: (button: string) => string;
  /** In the document panel when no file of the set is open. */
  noFileOpen: string;
  /** In the document panel while no file can be opened yet. */
  preparing: string;
  /** In the document panel when none of the files could be read. */
  nothingToOpen: string;
  /** Under a file that needs a decision; `button` is the name of the Redact button. */
  decisionHint: (button: string) => string;
  /** Asked before a file that is already out is removed while the table of the set is not saved. */
  unsavedConfirm: string;
}

export const batchStrings: FeatureStrings<BatchStrings> = {
  en: {
    title: 'Files',
    summary: (analysed, total) => `${analysed} of ${total} analysed`,
    addFiles: 'Add files',
    clearSet: 'Remove all',
    remove: (name) => `Remove ${name} from the set`,
    status: {
      waiting: 'Waiting',
      reading: 'Reading',
      analysing: 'Analysing',
      ready: 'Ready to review',
      opened: 'Opened',
      downloaded: 'Downloaded or copied',
      'needs-decision': 'Needs your decision',
      failed: 'Failed',
    },
    found: (places) => `${places} place${places !== 1 ? 's' : ''} found`,
    fileOf: (index, total, name) => `File ${index} of ${total}: ${name}`,
    readingTitle: 'Reading the file...',
    stopped: (waiting) => (waiting === 1 ? 'Stopped. 1 file is waiting.' : `Stopped. ${waiting} files are waiting.`),
    resume: 'Continue',
    waitingForModel: 'The files start on their own once the detection model is ready.',
    capReached: (max, left) => `A set holds at most ${max} files. Not added: ${left}.`,
    tooManyPairs: (max) => `The files of this set hold more than ${max} values, too many for one replacement table. Nothing was saved or restored. Remove some files and process them as a second set.`,
    tableConflict: 'One label stands for different values in two files of this set, so one table cannot serve both. Nothing was saved or restored. Process these files in separate sets.',
    failedFallback: 'This file could not be read.',
    detectionFailed: (button) => `The analysis of this file failed. Open it and press "${button}" to try again.`,
    noFileOpen: 'Choose a file from the list above.',
    preparing: 'The files are waiting to be analysed.',
    nothingToOpen: 'None of these files could be read. Add other files, or remove these.',
    decisionHint: (button) => `Open it, decide about the items that cannot be anonymised, then press "${button}".`,
    unsavedConfirm: 'The replacement table of these files is not saved. Without it the original data cannot be put back into a reply. Remove anyway?',
  },
  pl: {
    title: 'Pliki',
    summary: (analysed, total) => `Przeanalizowane: ${analysed} z ${total}`,
    addFiles: 'Dodaj pliki',
    clearSet: 'Usuń wszystkie',
    remove: (name) => `Usuń plik ${name} z zestawu`,
    status: {
      waiting: 'Czeka',
      reading: 'Odczyt',
      analysing: 'Analiza',
      ready: 'Gotowy do przejrzenia',
      opened: 'Otwarty',
      downloaded: 'Pobrany lub skopiowany',
      'needs-decision': 'Wymaga decyzji',
      failed: 'Nie udało się',
    },
    found: (places) => `znalezione miejsca: ${places}`,
    fileOf: (index, total, name) => `Plik ${index} z ${total}: ${name}`,
    readingTitle: 'Odczytywanie pliku...',
    stopped: (waiting) => `Zatrzymano. Pliki, które czekają: ${waiting}.`,
    resume: 'Kontynuuj',
    waitingForModel: 'Pliki ruszą same, gdy model detekcji będzie gotowy.',
    capReached: (max, left) => `Zestaw mieści najwyżej ${max} plików. Niedodane: ${left}.`,
    tooManyPairs: (max) => `Pliki tego zestawu zawierają ponad ${max} wartości - za dużo na jedną tabelę zamian. Nic nie zapisano ani nie przywrócono. Usuń część plików i przetwórz je jako drugi zestaw.`,
    tableConflict: 'Ta sama etykieta oznacza różne wartości w dwóch plikach tego zestawu, więc jedna tabela nie obsłuży obu. Nic nie zapisano ani nie przywrócono. Przetwórz te pliki w osobnych zestawach.',
    failedFallback: 'Nie udało się odczytać tego pliku.',
    detectionFailed: (button) => `Analiza tego pliku nie powiodła się. Otwórz go i kliknij „${button}”, aby spróbować ponownie.`,
    noFileOpen: 'Wybierz plik z listy powyżej.',
    preparing: 'Pliki czekają na analizę.',
    nothingToOpen: 'Żadnego z tych plików nie udało się odczytać. Dodaj inne pliki albo usuń te.',
    decisionHint: (button) => `Otwórz plik, zdecyduj o elementach, których nie da się zanonimizować, i kliknij „${button}”.`,
    unsavedConfirm: 'Tabela zamian tych plików nie jest zapisana. Bez niej nie da się przywrócić oryginalnych danych w odpowiedzi. Usunąć mimo to?',
  },
  de: {
    title: 'Dateien',
    summary: (analysed, total) => `${analysed} von ${total} analysiert`,
    addFiles: 'Dateien hinzufügen',
    clearSet: 'Alle entfernen',
    remove: (name) => `${name} aus dem Stapel entfernen`,
    status: {
      waiting: 'Wartet',
      reading: 'Wird gelesen',
      analysing: 'Wird analysiert',
      ready: 'Bereit zur Durchsicht',
      opened: 'Geöffnet',
      downloaded: 'Heruntergeladen oder kopiert',
      'needs-decision': 'Entscheidung nötig',
      failed: 'Fehlgeschlagen',
    },
    found: (places) => (places === 1 ? '1 Stelle gefunden' : `${places} Stellen gefunden`),
    fileOf: (index, total, name) => `Datei ${index} von ${total}: ${name}`,
    readingTitle: 'Datei wird gelesen...',
    stopped: (waiting) => (waiting === 1 ? 'Angehalten. 1 Datei wartet.' : `Angehalten. ${waiting} Dateien warten.`),
    resume: 'Fortsetzen',
    waitingForModel: 'Die Dateien starten von selbst, sobald das Erkennungsmodell bereit ist.',
    capReached: (max, left) => `Ein Stapel fasst höchstens ${max} Dateien. Nicht hinzugefügt: ${left}.`,
    tooManyPairs: (max) => `Die Dateien dieses Stapels enthalten mehr als ${max} Werte - zu viele für eine Ersetzungstabelle. Es wurde nichts gespeichert oder wiederhergestellt. Entfernen Sie einige Dateien und verarbeiten Sie sie als zweiten Stapel.`,
    tableConflict: 'Dieselbe Bezeichnung steht in zwei Dateien dieses Stapels für verschiedene Werte, eine Tabelle kann nicht beiden dienen. Es wurde nichts gespeichert oder wiederhergestellt. Verarbeiten Sie diese Dateien in getrennten Stapeln.',
    failedFallback: 'Diese Datei konnte nicht gelesen werden.',
    detectionFailed: (button) => `Die Analyse dieser Datei ist fehlgeschlagen. Öffnen Sie sie und wählen Sie „${button}“, um es erneut zu versuchen.`,
    noFileOpen: 'Wählen Sie eine Datei aus der Liste oben.',
    preparing: 'Die Dateien warten auf die Analyse.',
    nothingToOpen: 'Keine dieser Dateien konnte gelesen werden. Fügen Sie andere Dateien hinzu oder entfernen Sie diese.',
    decisionHint: (button) => `Öffnen Sie die Datei, entscheiden Sie über die Elemente, die sich nicht anonymisieren lassen, und wählen Sie dann „${button}“.`,
    unsavedConfirm: 'Die Ersetzungstabelle dieser Dateien ist nicht gespeichert. Ohne sie lassen sich die Originaldaten nicht wieder in eine Antwort einsetzen. Trotzdem entfernen?',
  },
  fr: {
    title: 'Fichiers',
    summary: (analysed, total) => `${analysed} sur ${total} analysé${analysed !== 1 ? 's' : ''}`,
    addFiles: 'Ajouter des fichiers',
    clearSet: 'Tout retirer',
    remove: (name) => `Retirer ${name} du lot`,
    status: {
      waiting: 'En attente',
      reading: 'Lecture',
      analysing: 'Analyse',
      ready: 'Prêt à vérifier',
      opened: 'Ouvert',
      downloaded: 'Téléchargé ou copié',
      'needs-decision': 'Décision requise',
      failed: 'Échec',
    },
    found: (places) => `${places} endroit${places !== 1 ? 's' : ''} trouvé${places !== 1 ? 's' : ''}`,
    fileOf: (index, total, name) => `Fichier ${index} sur ${total} : ${name}`,
    readingTitle: 'Lecture du fichier...',
    stopped: (waiting) => (waiting === 1 ? 'Arrêté. 1 fichier attend.' : `Arrêté. ${waiting} fichiers attendent.`),
    resume: 'Continuer',
    waitingForModel: 'Les fichiers démarrent d\'eux-mêmes dès que le modèle de détection est prêt.',
    capReached: (max, left) => `Un lot contient au plus ${max} fichiers. Non ajoutés : ${left}.`,
    tooManyPairs: (max) => `Les fichiers de ce lot contiennent plus de ${max} valeurs, trop pour une seule table de correspondance. Rien n'a été enregistré ni restauré. Retirez des fichiers et traitez-les dans un second lot.`,
    tableConflict: 'Un même marqueur désigne des valeurs différentes dans deux fichiers de ce lot : une seule table ne peut pas servir aux deux. Rien n\'a été enregistré ni restauré. Traitez ces fichiers dans des lots séparés.',
    failedFallback: 'Ce fichier n\'a pas pu être lu.',
    detectionFailed: (button) => `L'analyse de ce fichier a échoué. Ouvrez-le et choisissez « ${button} » pour réessayer.`,
    noFileOpen: 'Choisissez un fichier dans la liste ci-dessus.',
    preparing: 'Les fichiers attendent leur analyse.',
    nothingToOpen: 'Aucun de ces fichiers n\'a pu être lu. Ajoutez d\'autres fichiers ou retirez ceux-ci.',
    decisionHint: (button) => `Ouvrez-le, décidez du sort des éléments qui ne peuvent pas être anonymisés, puis choisissez « ${button} ».`,
    unsavedConfirm: 'La table de correspondance de ces fichiers n\'est pas enregistrée. Sans elle, les données d\'origine ne peuvent pas être remises dans une réponse. Retirer quand même ?',
  },
  es: {
    title: 'Archivos',
    summary: (analysed, total) => `${analysed} de ${total} analizado${analysed !== 1 ? 's' : ''}`,
    addFiles: 'Añadir archivos',
    clearSet: 'Quitar todos',
    remove: (name) => `Quitar ${name} del lote`,
    status: {
      waiting: 'En espera',
      reading: 'Leyendo',
      analysing: 'Analizando',
      ready: 'Listo para revisar',
      opened: 'Abierto',
      downloaded: 'Descargado o copiado',
      'needs-decision': 'Requiere su decisión',
      failed: 'Error',
    },
    found: (places) => `${places} lugar${places !== 1 ? 'es' : ''} encontrado${places !== 1 ? 's' : ''}`,
    fileOf: (index, total, name) => `Archivo ${index} de ${total}: ${name}`,
    readingTitle: 'Leyendo el archivo...',
    stopped: (waiting) => (waiting === 1 ? 'Detenido. 1 archivo espera.' : `Detenido. ${waiting} archivos esperan.`),
    resume: 'Continuar',
    waitingForModel: 'Los archivos empiezan solos en cuanto el modelo de detección esté listo.',
    capReached: (max, left) => `Un lote admite como máximo ${max} archivos. No añadidos: ${left}.`,
    tooManyPairs: (max) => `Los archivos de este lote contienen más de ${max} valores, demasiados para una sola tabla de reemplazos. No se guardó ni se restauró nada. Quite algunos archivos y procéselos en un segundo lote.`,
    tableConflict: 'Una misma etiqueta representa valores distintos en dos archivos de este lote, así que una sola tabla no sirve para ambos. No se guardó ni se restauró nada. Procese estos archivos en lotes separados.',
    failedFallback: 'No se pudo leer este archivo.',
    detectionFailed: (button) => `El análisis de este archivo falló. Ábralo y pulse "${button}" para intentarlo de nuevo.`,
    noFileOpen: 'Elija un archivo de la lista de arriba.',
    preparing: 'Los archivos esperan su análisis.',
    nothingToOpen: 'No se pudo leer ninguno de estos archivos. Añada otros archivos o quite estos.',
    decisionHint: (button) => `Ábralo, decida sobre los elementos que no se pueden anonimizar y pulse "${button}".`,
    unsavedConfirm: 'La tabla de reemplazos de estos archivos no está guardada. Sin ella no se pueden devolver los datos originales a una respuesta. ¿Quitar de todos modos?',
  },
  pt: {
    title: 'Ficheiros',
    summary: (analysed, total) => `${analysed} de ${total} analisado${analysed !== 1 ? 's' : ''}`,
    addFiles: 'Adicionar ficheiros',
    clearSet: 'Remover todos',
    remove: (name) => `Remover ${name} do lote`,
    status: {
      waiting: 'Em espera',
      reading: 'A ler',
      analysing: 'A analisar',
      ready: 'Pronto para rever',
      opened: 'Aberto',
      downloaded: 'Transferido ou copiado',
      'needs-decision': 'Requer a sua decisão',
      failed: 'Falhou',
    },
    found: (places) => `${places} ${places === 1 ? 'local encontrado' : 'locais encontrados'}`,
    fileOf: (index, total, name) => `Ficheiro ${index} de ${total}: ${name}`,
    readingTitle: 'A ler o ficheiro...',
    stopped: (waiting) => (waiting === 1 ? 'Parado. 1 ficheiro em espera.' : `Parado. ${waiting} ficheiros em espera.`),
    resume: 'Continuar',
    waitingForModel: 'Os ficheiros começam sozinhos assim que o modelo de deteção estiver pronto.',
    capReached: (max, left) => `Um lote aceita no máximo ${max} ficheiros. Não adicionados: ${left}.`,
    tooManyPairs: (max) => `Os ficheiros deste lote contêm mais de ${max} valores, demasiados para uma só tabela de substituições. Nada foi guardado nem restaurado. Remova alguns ficheiros e processe-os num segundo lote.`,
    tableConflict: 'O mesmo marcador representa valores diferentes em dois ficheiros deste lote, pelo que uma só tabela não serve para ambos. Nada foi guardado nem restaurado. Processe estes ficheiros em lotes separados.',
    failedFallback: 'Não foi possível ler este ficheiro.',
    detectionFailed: (button) => `A análise deste ficheiro falhou. Abra-o e prima "${button}" para tentar de novo.`,
    noFileOpen: 'Escolha um ficheiro na lista acima.',
    preparing: 'Os ficheiros aguardam a análise.',
    nothingToOpen: 'Não foi possível ler nenhum destes ficheiros. Adicione outros ficheiros ou remova estes.',
    decisionHint: (button) => `Abra-o, decida sobre os itens que não podem ser anonimizados e prima "${button}".`,
    unsavedConfirm: 'A tabela de substituições destes ficheiros não está guardada. Sem ela não é possível repor os dados originais numa resposta. Remover mesmo assim?',
  },
  sv: {
    title: 'Filer',
    summary: (analysed, total) => `${analysed} av ${total} analyserade`,
    addFiles: 'Lägg till filer',
    clearSet: 'Ta bort alla',
    remove: (name) => `Ta bort ${name} ur gruppen`,
    status: {
      waiting: 'Väntar',
      reading: 'Läses',
      analysing: 'Analyseras',
      ready: 'Klar att granska',
      opened: 'Öppnad',
      downloaded: 'Nedladdad eller kopierad',
      'needs-decision': 'Kräver ditt beslut',
      failed: 'Misslyckades',
    },
    found: (places) => `${places} ställe${places !== 1 ? 'n' : ''} hittades`,
    fileOf: (index, total, name) => `Fil ${index} av ${total}: ${name}`,
    readingTitle: 'Läser filen...',
    stopped: (waiting) => (waiting === 1 ? 'Stoppad. 1 fil väntar.' : `Stoppad. ${waiting} filer väntar.`),
    resume: 'Fortsätt',
    waitingForModel: 'Filerna startar av sig själva när detektionsmodellen är redo.',
    capReached: (max, left) => `En grupp rymmer högst ${max} filer. Inte tillagda: ${left}.`,
    tooManyPairs: (max) => `Filerna i den här gruppen innehåller fler än ${max} värden, för många för en ersättningstabell. Inget sparades eller återställdes. Ta bort några filer och bearbeta dem som en andra grupp.`,
    tableConflict: 'Samma etikett står för olika värden i två filer i den här gruppen, så en tabell kan inte gälla för båda. Inget sparades eller återställdes. Bearbeta de här filerna i skilda grupper.',
    failedFallback: 'Den här filen kunde inte läsas.',
    detectionFailed: (button) => `Analysen av den här filen misslyckades. Öppna den och välj "${button}" för att försöka igen.`,
    noFileOpen: 'Välj en fil i listan ovan.',
    preparing: 'Filerna väntar på analys.',
    nothingToOpen: 'Ingen av de här filerna kunde läsas. Lägg till andra filer eller ta bort de här.',
    decisionHint: (button) => `Öppna den, bestäm vad som ska hända med objekten som inte kan anonymiseras och välj sedan "${button}".`,
    unsavedConfirm: 'Ersättningstabellen för de här filerna är inte sparad. Utan den går originaluppgifterna inte att sätta tillbaka i ett svar. Ta bort ändå?',
  },
  no: {
    title: 'Filer',
    summary: (analysed, total) => `${analysed} av ${total} analysert`,
    addFiles: 'Legg til filer',
    clearSet: 'Fjern alle',
    remove: (name) => `Fjern ${name} fra gruppen`,
    status: {
      waiting: 'Venter',
      reading: 'Leses',
      analysing: 'Analyseres',
      ready: 'Klar til gjennomgang',
      opened: 'Åpnet',
      downloaded: 'Lastet ned eller kopiert',
      'needs-decision': 'Krever din avgjørelse',
      failed: 'Mislyktes',
    },
    found: (places) => `${places} sted${places !== 1 ? 'er' : ''} funnet`,
    fileOf: (index, total, name) => `Fil ${index} av ${total}: ${name}`,
    readingTitle: 'Leser filen...',
    stopped: (waiting) => (waiting === 1 ? 'Stoppet. 1 fil venter.' : `Stoppet. ${waiting} filer venter.`),
    resume: 'Fortsett',
    waitingForModel: 'Filene starter av seg selv når deteksjonsmodellen er klar.',
    capReached: (max, left) => `En gruppe rommer høyst ${max} filer. Ikke lagt til: ${left}.`,
    tooManyPairs: (max) => `Filene i denne gruppen inneholder mer enn ${max} verdier, for mange for én erstatningstabell. Ingenting ble lagret eller gjenopprettet. Fjern noen filer og behandle dem som en ny gruppe.`,
    tableConflict: 'Samme etikett står for ulike verdier i to filer i denne gruppen, så én tabell kan ikke gjelde for begge. Ingenting ble lagret eller gjenopprettet. Behandle disse filene i hver sin gruppe.',
    failedFallback: 'Denne filen kunne ikke leses.',
    detectionFailed: (button) => `Analysen av denne filen mislyktes. Åpne den og velg «${button}» for å prøve på nytt.`,
    noFileOpen: 'Velg en fil fra listen over.',
    preparing: 'Filene venter på analyse.',
    nothingToOpen: 'Ingen av disse filene kunne leses. Legg til andre filer, eller fjern disse.',
    decisionHint: (button) => `Åpne den, bestem hva som skal skje med elementene som ikke kan anonymiseres, og velg deretter «${button}».`,
    unsavedConfirm: 'Erstatningstabellen for disse filene er ikke lagret. Uten den kan de opprinnelige opplysningene ikke settes tilbake i et svar. Fjerne likevel?',
  },
};
