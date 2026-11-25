/**
 * Strings of "edit a PDF by hand" (T284, WLojek/DocCloak.Core#6): the page view of a loaded PDF,
 * where whole pages are left out and areas are hidden (a signature, a handwritten name, a stamp).
 * Two words are kept apart in every language: a page is "left out", an area is "hidden"; neither
 * is "redacted", which stays the word for what the detection finds.
 */
import type { FeatureStrings } from './index.ts';

export interface PdfEditStrings {
  /** Caption of the section. */
  title: string;
  /** Next to the caption while nothing is changed: what the section is for. */
  hint: string;
  /** Parts of the summary line: "2 pages left out", "3 areas hidden". */
  pagesLeftOut: (count: number) => string;
  areasHidden: (count: number) => string;
  /** Takes every edit back. */
  undoAll: string;
  /** Over the pages: what leaving a page out does, and how to hide an area. */
  note: string;
  loading: string;
  failed: string;
  /** Heading of the large view of a page. */
  pageOf: (page: number, total: number) => string;
  /** Name of a thumbnail (it opens the page). */
  openPage: (page: number) => string;
  /** The toggle under a thumbnail, and its full name with the page number. */
  leaveOut: string;
  bringBack: string;
  leaveOutPage: (page: number) => string;
  bringBackPage: (page: number) => string;
  /** Written over a page that is left out. */
  leftOut: string;
  /** Why the last page that is still in cannot be left out. */
  lastPage: string;
  /** In the large view: how to hide an area and what that does to the downloaded file. */
  areaHelp: string;
  /** In the large view of a page that is left out. */
  leftOutHelp: string;
  /** The keyboard way to hide an area: puts one in the middle of the page. */
  addArea: string;
  /** Name of a hidden area for screen readers. */
  area: (index: number, total: number) => string;
  removeArea: (index: number) => string;
  /** How the keyboard moves, resizes and removes the area that has the focus. */
  keysHint: string;
  previous: string;
  next: string;
  close: string;
  done: string;
  /** An edit brought text back that was never analysed: the result is cleared. `redact` is the name of the Redact button. */
  redactAgain: (redact: string) => string;
  /** Found items whose text an edit took out of the document. */
  itemsGone: (count: number) => string;
  /** The edit was refused (it should never be): nothing changed. */
  editFailed: string;
  /** Notes after a download. `pages` is a list of page numbers ("2, 5-7"), `count` how many pages it names. */
  exportLeftOut: (pages: string, count: number) => string;
  /** Pages with hidden areas, saved as pictures that keep their text as an invisible layer. */
  exportAreas: (pages: string, count: number) => string;
  /** Pages with hidden areas whose text could not be kept: a picture only. */
  exportAreasNoText: (pages: string, count: number) => string;
  /** The download was refused: a page with a hidden area cannot be made into a picture. */
  areaRefused: (pages: string, count: number) => string;
  /** A page with a hidden area holds text a rectangle cannot take out of the analysed text (Core's limit). */
  areaTextStays: (pages: string, count: number) => string;
}

/** Polish: 1 strona, 2-4 strony, 5+ stron (12-14 as 5+). */
function pl(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  const last = count % 10;
  const lastTwo = count % 100;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
}

export const pdfEditStrings: FeatureStrings<PdfEditStrings> = {
  en: {
    title: 'Pages',
    hint: 'Leave pages out or hide areas by hand',
    pagesLeftOut: (count) => (count === 1 ? '1 page left out' : `${count} pages left out`),
    areasHidden: (count) => (count === 1 ? '1 area hidden' : `${count} areas hidden`),
    undoAll: 'Undo all',
    note: 'A page left out is not in the downloaded file. Open a page to hide an area on it.',
    loading: 'Loading the pages...',
    failed: 'The pages cannot be shown.',
    pageOf: (page, total) => `Page ${page} of ${total}`,
    openPage: (page) => `Open page ${page} to hide areas`,
    leaveOut: 'Leave out',
    bringBack: 'Bring back',
    leaveOutPage: (page) => `Leave page ${page} out`,
    bringBackPage: (page) => `Bring page ${page} back`,
    leftOut: 'Left out',
    lastPage: 'At least one page must stay.',
    areaHelp: 'Drag over what you want to hide. The area is painted black in the downloaded file and its text is removed; a letter the area touches is hidden whole. The page is exported as a picture.',
    leftOutHelp: 'This page is left out: it is not in the downloaded file.',
    addArea: 'Add an area',
    area: (index, total) => `Hidden area ${index} of ${total}`,
    removeArea: (index) => `Remove hidden area ${index}`,
    keysHint: 'Arrow keys move the area, Shift with the arrow keys resizes it, Delete removes it.',
    previous: 'Previous page',
    next: 'Next page',
    close: 'Close',
    done: 'Done',
    redactAgain: (redact) => `Text came back into the document, so the list of found items was cleared. Press "${redact}" again.`,
    itemsGone: (count) => (count === 1 ? '1 found item left with the text that was taken out.' : `${count} found items left with the text that was taken out.`),
    editFailed: 'This change could not be applied. Nothing was changed.',
    exportLeftOut: (pages, count) => (count === 1 ? `Page ${pages} was left out: it is not in this file.` : `Pages ${pages} were left out: they are not in this file.`),
    exportAreas: (pages, count) => (count === 1 ? `Page ${pages}: the hidden areas are painted black; the page is saved as an image with a searchable text layer.` : `Pages ${pages}: the hidden areas are painted black; the pages are saved as images with a searchable text layer.`),
    exportAreasNoText: (pages, count) => (count === 1 ? `Page ${pages}: the hidden areas are painted black; the page is saved as an image and its text layer is gone.` : `Pages ${pages}: the hidden areas are painted black; the pages are saved as images and their text layer is gone.`),
    areaRefused: (pages, count) => (count === 1 ? `Page ${pages} cannot be saved as an image, so the area on it cannot be hidden. Leave the page out or take the area away. Nothing was downloaded.` : `Pages ${pages} cannot be saved as images, so the areas on them cannot be hidden. Leave the pages out or take the areas away. Nothing was downloaded.`),
    areaTextStays: (pages, count) => `${count === 1 ? `Page ${pages} holds` : `Pages ${pages} hold`} text inside a pattern or a mask: a hidden area paints it black, but that text stays in what DocCloak analyses. Check the downloaded file.`,
  },
  pl: {
    title: 'Strony',
    hint: 'Pomiń strony lub zakryj obszary ręcznie',
    pagesLeftOut: (count) => `${count} ${pl(count, 'strona pominięta', 'strony pominięte', 'stron pominiętych')}`,
    areasHidden: (count) => `${count} ${pl(count, 'obszar zakryty', 'obszary zakryte', 'obszarów zakrytych')}`,
    undoAll: 'Cofnij wszystko',
    note: 'Pominiętej strony nie będzie w pobranym pliku. Otwórz stronę, aby zakryć na niej obszar.',
    loading: 'Wczytywanie stron...',
    failed: 'Nie można pokazać stron.',
    pageOf: (page, total) => `Strona ${page} z ${total}`,
    openPage: (page) => `Otwórz stronę ${page}, aby zakryć obszary`,
    leaveOut: 'Pomiń',
    bringBack: 'Przywróć',
    leaveOutPage: (page) => `Pomiń stronę ${page}`,
    bringBackPage: (page) => `Przywróć stronę ${page}`,
    leftOut: 'Pominięta',
    lastPage: 'Co najmniej jedna strona musi zostać.',
    areaHelp: 'Przeciągnij po tym, co chcesz zakryć. W pobranym pliku obszar będzie zamalowany na czarno, a jego tekst usunięty; litera, której obszar dotyka, znika cała. Strona zostanie zapisana jako obraz.',
    leftOutHelp: 'Ta strona jest pominięta: nie będzie jej w pobranym pliku.',
    addArea: 'Dodaj obszar',
    area: (index, total) => `Zakryty obszar ${index} z ${total}`,
    removeArea: (index) => `Usuń zakryty obszar ${index}`,
    keysHint: 'Strzałki przesuwają obszar, Shift ze strzałkami zmienia jego rozmiar, Delete go usuwa.',
    previous: 'Poprzednia strona',
    next: 'Następna strona',
    close: 'Zamknij',
    done: 'Gotowe',
    redactAgain: (redact) => `Do dokumentu wrócił tekst, więc lista znalezionych danych została wyczyszczona. Kliknij „${redact}” ponownie.`,
    itemsGone: (count) => pl(count, '1 znaleziona pozycja zniknęła razem z usuniętym tekstem.', `${count} znalezione pozycje zniknęły razem z usuniętym tekstem.`, `${count} znalezionych pozycji zniknęło razem z usuniętym tekstem.`),
    editFailed: 'Tej zmiany nie udało się zastosować. Nic się nie zmieniło.',
    exportLeftOut: (pages, count) => (count === 1 ? `Strona ${pages} została pominięta: nie ma jej w tym pliku.` : `Strony ${pages} zostały pominięte: nie ma ich w tym pliku.`),
    exportAreas: (pages, count) => (count === 1 ? `Strona ${pages}: zakryte obszary są zamalowane na czarno; strona jest zapisana jako obraz z przeszukiwalną warstwą tekstową.` : `Strony ${pages}: zakryte obszary są zamalowane na czarno; strony są zapisane jako obrazy z przeszukiwalną warstwą tekstową.`),
    exportAreasNoText: (pages, count) => (count === 1 ? `Strona ${pages}: zakryte obszary są zamalowane na czarno; strona jest zapisana jako obraz, a jej warstwa tekstowa zniknęła.` : `Strony ${pages}: zakryte obszary są zamalowane na czarno; strony są zapisane jako obrazy, a ich warstwa tekstowa zniknęła.`),
    areaRefused: (pages, count) => (count === 1 ? `Strony ${pages} nie da się zapisać jako obrazu, więc nie można zakryć na niej obszaru. Pomiń tę stronę albo usuń obszar. Nic nie zostało pobrane.` : `Stron ${pages} nie da się zapisać jako obrazów, więc nie można zakryć na nich obszarów. Pomiń te strony albo usuń obszary. Nic nie zostało pobrane.`),
    areaTextStays: (pages, count) => `${count === 1 ? `Strona ${pages} zawiera` : `Strony ${pages} zawierają`} tekst we wzorze lub masce: zakryty obszar zamaluje go na czarno, ale ten tekst zostaje w tym, co DocCloak analizuje. Sprawdź pobrany plik.`,
  },
  de: {
    title: 'Seiten',
    hint: 'Seiten weglassen oder Bereiche von Hand abdecken',
    pagesLeftOut: (count) => (count === 1 ? '1 Seite weggelassen' : `${count} Seiten weggelassen`),
    areasHidden: (count) => (count === 1 ? '1 Bereich abgedeckt' : `${count} Bereiche abgedeckt`),
    undoAll: 'Alles zurücknehmen',
    note: 'Eine weggelassene Seite fehlt in der heruntergeladenen Datei. Öffnen Sie eine Seite, um darauf einen Bereich abzudecken.',
    loading: 'Seiten werden geladen...',
    failed: 'Die Seiten können nicht angezeigt werden.',
    pageOf: (page, total) => `Seite ${page} von ${total}`,
    openPage: (page) => `Seite ${page} öffnen, um Bereiche abzudecken`,
    leaveOut: 'Weglassen',
    bringBack: 'Zurückholen',
    leaveOutPage: (page) => `Seite ${page} weglassen`,
    bringBackPage: (page) => `Seite ${page} zurückholen`,
    leftOut: 'Weggelassen',
    lastPage: 'Mindestens eine Seite muss bleiben.',
    areaHelp: 'Ziehen Sie über das, was abgedeckt werden soll. Der Bereich wird in der heruntergeladenen Datei schwarz übermalt und sein Text entfernt; ein Buchstabe, den der Bereich berührt, verschwindet ganz. Die Seite wird als Bild exportiert.',
    leftOutHelp: 'Diese Seite ist weggelassen: Sie fehlt in der heruntergeladenen Datei.',
    addArea: 'Bereich hinzufügen',
    area: (index, total) => `Abgedeckter Bereich ${index} von ${total}`,
    removeArea: (index) => `Abgedeckten Bereich ${index} entfernen`,
    keysHint: 'Die Pfeiltasten verschieben den Bereich, Umschalt mit den Pfeiltasten ändert seine Größe, Entf entfernt ihn.',
    previous: 'Vorherige Seite',
    next: 'Nächste Seite',
    close: 'Schließen',
    done: 'Fertig',
    redactAgain: (redact) => `Es ist wieder Text ins Dokument gekommen, deshalb wurde die Liste der Fundstellen geleert. Klicken Sie erneut auf „${redact}“.`,
    itemsGone: (count) => (count === 1 ? '1 Fundstelle ist mit dem entfernten Text verschwunden.' : `${count} Fundstellen sind mit dem entfernten Text verschwunden.`),
    editFailed: 'Diese Änderung konnte nicht angewendet werden. Es wurde nichts geändert.',
    exportLeftOut: (pages, count) => (count === 1 ? `Seite ${pages} wurde weggelassen: Sie ist nicht in dieser Datei.` : `Die Seiten ${pages} wurden weggelassen: Sie sind nicht in dieser Datei.`),
    exportAreas: (pages, count) => (count === 1 ? `Seite ${pages}: Die abgedeckten Bereiche sind schwarz übermalt; die Seite ist als Bild mit einer durchsuchbaren Textebene gespeichert.` : `Die Seiten ${pages}: Die abgedeckten Bereiche sind schwarz übermalt; die Seiten sind als Bilder mit einer durchsuchbaren Textebene gespeichert.`),
    exportAreasNoText: (pages, count) => (count === 1 ? `Seite ${pages}: Die abgedeckten Bereiche sind schwarz übermalt; die Seite ist als Bild gespeichert, ihre Textebene ist weg.` : `Die Seiten ${pages}: Die abgedeckten Bereiche sind schwarz übermalt; die Seiten sind als Bilder gespeichert, ihre Textebene ist weg.`),
    areaRefused: (pages, count) => (count === 1 ? `Seite ${pages} lässt sich nicht als Bild speichern, deshalb kann der Bereich darauf nicht abgedeckt werden. Lassen Sie die Seite weg oder entfernen Sie den Bereich. Es wurde nichts heruntergeladen.` : `Die Seiten ${pages} lassen sich nicht als Bilder speichern, deshalb können die Bereiche darauf nicht abgedeckt werden. Lassen Sie die Seiten weg oder entfernen Sie die Bereiche. Es wurde nichts heruntergeladen.`),
    areaTextStays: (pages, count) => `${count === 1 ? `Seite ${pages} enthält` : `Die Seiten ${pages} enthalten`} Text in einem Muster oder einer Maske: Ein abgedeckter Bereich übermalt ihn schwarz, aber der Text bleibt in dem, was DocCloak analysiert. Prüfen Sie die heruntergeladene Datei.`,
  },
  fr: {
    title: 'Pages',
    hint: 'Retirer des pages ou masquer des zones à la main',
    pagesLeftOut: (count) => (count === 1 ? '1 page retirée' : `${count} pages retirées`),
    areasHidden: (count) => (count === 1 ? '1 zone masquée' : `${count} zones masquées`),
    undoAll: 'Tout annuler',
    note: 'Une page retirée ne figure pas dans le fichier téléchargé. Ouvrez une page pour y masquer une zone.',
    loading: 'Chargement des pages...',
    failed: 'Impossible d\'afficher les pages.',
    pageOf: (page, total) => `Page ${page} sur ${total}`,
    openPage: (page) => `Ouvrir la page ${page} pour masquer des zones`,
    leaveOut: 'Retirer',
    bringBack: 'Remettre',
    leaveOutPage: (page) => `Retirer la page ${page}`,
    bringBackPage: (page) => `Remettre la page ${page}`,
    leftOut: 'Retirée',
    lastPage: 'Au moins une page doit rester.',
    areaHelp: 'Faites glisser sur ce que vous voulez masquer. Dans le fichier téléchargé, la zone est peinte en noir et son texte est supprimé ; une lettre que la zone touche est masquée en entier. La page est exportée sous forme d\'image.',
    leftOutHelp: 'Cette page est retirée : elle ne figure pas dans le fichier téléchargé.',
    addArea: 'Ajouter une zone',
    area: (index, total) => `Zone masquée ${index} sur ${total}`,
    removeArea: (index) => `Supprimer la zone masquée ${index}`,
    keysHint: 'Les flèches déplacent la zone, Maj avec les flèches change sa taille, Suppr la supprime.',
    previous: 'Page précédente',
    next: 'Page suivante',
    close: 'Fermer',
    done: 'Terminé',
    redactAgain: (redact) => `Du texte est revenu dans le document : la liste des éléments trouvés a été vidée. Cliquez de nouveau sur « ${redact} ».`,
    itemsGone: (count) => (count === 1 ? '1 élément trouvé est parti avec le texte retiré.' : `${count} éléments trouvés sont partis avec le texte retiré.`),
    editFailed: 'Cette modification n\'a pas pu être appliquée. Rien n\'a changé.',
    exportLeftOut: (pages, count) => (count === 1 ? `La page ${pages} a été retirée : elle ne figure pas dans ce fichier.` : `Les pages ${pages} ont été retirées : elles ne figurent pas dans ce fichier.`),
    exportAreas: (pages, count) => (count === 1 ? `Page ${pages} : les zones masquées sont peintes en noir ; la page est enregistrée comme image avec une couche de texte consultable.` : `Pages ${pages} : les zones masquées sont peintes en noir ; les pages sont enregistrées comme images avec une couche de texte consultable.`),
    exportAreasNoText: (pages, count) => (count === 1 ? `Page ${pages} : les zones masquées sont peintes en noir ; la page est enregistrée comme image et sa couche de texte a disparu.` : `Pages ${pages} : les zones masquées sont peintes en noir ; les pages sont enregistrées comme images et leur couche de texte a disparu.`),
    areaRefused: (pages, count) => (count === 1 ? `La page ${pages} ne peut pas être enregistrée comme image : la zone qui s'y trouve ne peut donc pas être masquée. Retirez la page ou supprimez la zone. Rien n'a été téléchargé.` : `Les pages ${pages} ne peuvent pas être enregistrées comme images : les zones qui s'y trouvent ne peuvent donc pas être masquées. Retirez les pages ou supprimez les zones. Rien n'a été téléchargé.`),
    areaTextStays: (pages, count) => `${count === 1 ? `La page ${pages} contient` : `Les pages ${pages} contiennent`} du texte dans un motif ou un masque : une zone masquée le peint en noir, mais ce texte reste dans ce que DocCloak analyse. Vérifiez le fichier téléchargé.`,
  },
  es: {
    title: 'Páginas',
    hint: 'Quitar páginas u ocultar zonas a mano',
    pagesLeftOut: (count) => (count === 1 ? '1 página quitada' : `${count} páginas quitadas`),
    areasHidden: (count) => (count === 1 ? '1 zona oculta' : `${count} zonas ocultas`),
    undoAll: 'Deshacer todo',
    note: 'Una página quitada no está en el archivo descargado. Abra una página para ocultar una zona en ella.',
    loading: 'Cargando las páginas...',
    failed: 'No se pueden mostrar las páginas.',
    pageOf: (page, total) => `Página ${page} de ${total}`,
    openPage: (page) => `Abrir la página ${page} para ocultar zonas`,
    leaveOut: 'Quitar',
    bringBack: 'Recuperar',
    leaveOutPage: (page) => `Quitar la página ${page}`,
    bringBackPage: (page) => `Recuperar la página ${page}`,
    leftOut: 'Quitada',
    lastPage: 'Debe quedar al menos una página.',
    areaHelp: 'Arrastre sobre lo que quiere ocultar. En el archivo descargado la zona queda pintada de negro y su texto se elimina; una letra que la zona toca se oculta entera. La página se exporta como imagen.',
    leftOutHelp: 'Esta página está quitada: no está en el archivo descargado.',
    addArea: 'Añadir una zona',
    area: (index, total) => `Zona oculta ${index} de ${total}`,
    removeArea: (index) => `Eliminar la zona oculta ${index}`,
    keysHint: 'Las flechas mueven la zona, Mayús con las flechas cambia su tamaño, Supr la elimina.',
    previous: 'Página anterior',
    next: 'Página siguiente',
    close: 'Cerrar',
    done: 'Listo',
    redactAgain: (redact) => `Ha vuelto texto al documento, así que la lista de datos encontrados se ha vaciado. Pulse "${redact}" otra vez.`,
    itemsGone: (count) => (count === 1 ? '1 dato encontrado se fue con el texto quitado.' : `${count} datos encontrados se fueron con el texto quitado.`),
    editFailed: 'No se pudo aplicar este cambio. No se ha cambiado nada.',
    exportLeftOut: (pages, count) => (count === 1 ? `La página ${pages} se quitó: no está en este archivo.` : `Las páginas ${pages} se quitaron: no están en este archivo.`),
    exportAreas: (pages, count) => (count === 1 ? `Página ${pages}: las zonas ocultas están pintadas de negro; la página se guarda como imagen con una capa de texto en la que se puede buscar.` : `Páginas ${pages}: las zonas ocultas están pintadas de negro; las páginas se guardan como imágenes con una capa de texto en la que se puede buscar.`),
    exportAreasNoText: (pages, count) => (count === 1 ? `Página ${pages}: las zonas ocultas están pintadas de negro; la página se guarda como imagen y su capa de texto ha desaparecido.` : `Páginas ${pages}: las zonas ocultas están pintadas de negro; las páginas se guardan como imágenes y su capa de texto ha desaparecido.`),
    areaRefused: (pages, count) => (count === 1 ? `La página ${pages} no se puede guardar como imagen, así que la zona que hay en ella no se puede ocultar. Quite la página o elimine la zona. No se descargó nada.` : `Las páginas ${pages} no se pueden guardar como imágenes, así que las zonas que hay en ellas no se pueden ocultar. Quite las páginas o elimine las zonas. No se descargó nada.`),
    areaTextStays: (pages, count) => `${count === 1 ? `La página ${pages} tiene` : `Las páginas ${pages} tienen`} texto dentro de un patrón o una máscara: una zona oculta lo pinta de negro, pero ese texto sigue en lo que DocCloak analiza. Revise el archivo descargado.`,
  },
  pt: {
    title: 'Páginas',
    hint: 'Retirar páginas ou ocultar zonas à mão',
    pagesLeftOut: (count) => (count === 1 ? '1 página retirada' : `${count} páginas retiradas`),
    areasHidden: (count) => (count === 1 ? '1 zona oculta' : `${count} zonas ocultas`),
    undoAll: 'Anular tudo',
    note: 'Uma página retirada não fica no ficheiro transferido. Abra uma página para ocultar uma zona nela.',
    loading: 'A carregar as páginas...',
    failed: 'Não é possível mostrar as páginas.',
    pageOf: (page, total) => `Página ${page} de ${total}`,
    openPage: (page) => `Abrir a página ${page} para ocultar zonas`,
    leaveOut: 'Retirar',
    bringBack: 'Repor',
    leaveOutPage: (page) => `Retirar a página ${page}`,
    bringBackPage: (page) => `Repor a página ${page}`,
    leftOut: 'Retirada',
    lastPage: 'Tem de ficar pelo menos uma página.',
    areaHelp: 'Arraste sobre o que quer ocultar. No ficheiro transferido a zona fica pintada de preto e o seu texto é removido; uma letra em que a zona toca é ocultada por inteiro. A página é exportada como imagem.',
    leftOutHelp: 'Esta página está retirada: não fica no ficheiro transferido.',
    addArea: 'Adicionar uma zona',
    area: (index, total) => `Zona oculta ${index} de ${total}`,
    removeArea: (index) => `Remover a zona oculta ${index}`,
    keysHint: 'As setas movem a zona, Shift com as setas altera o tamanho, Delete remove-a.',
    previous: 'Página anterior',
    next: 'Página seguinte',
    close: 'Fechar',
    done: 'Concluído',
    redactAgain: (redact) => `Voltou texto ao documento, por isso a lista de dados encontrados foi esvaziada. Clique em "${redact}" outra vez.`,
    itemsGone: (count) => (count === 1 ? '1 dado encontrado saiu com o texto retirado.' : `${count} dados encontrados saíram com o texto retirado.`),
    editFailed: 'Não foi possível aplicar esta alteração. Nada foi alterado.',
    exportLeftOut: (pages, count) => (count === 1 ? `A página ${pages} foi retirada: não está neste ficheiro.` : `As páginas ${pages} foram retiradas: não estão neste ficheiro.`),
    exportAreas: (pages, count) => (count === 1 ? `Página ${pages}: as zonas ocultas estão pintadas de preto; a página é guardada como imagem com uma camada de texto pesquisável.` : `Páginas ${pages}: as zonas ocultas estão pintadas de preto; as páginas são guardadas como imagens com uma camada de texto pesquisável.`),
    exportAreasNoText: (pages, count) => (count === 1 ? `Página ${pages}: as zonas ocultas estão pintadas de preto; a página é guardada como imagem e a sua camada de texto desapareceu.` : `Páginas ${pages}: as zonas ocultas estão pintadas de preto; as páginas são guardadas como imagens e a sua camada de texto desapareceu.`),
    areaRefused: (pages, count) => (count === 1 ? `A página ${pages} não pode ser guardada como imagem, por isso a zona que está nela não pode ser ocultada. Retire a página ou remova a zona. Nada foi transferido.` : `As páginas ${pages} não podem ser guardadas como imagens, por isso as zonas que estão nelas não podem ser ocultadas. Retire as páginas ou remova as zonas. Nada foi transferido.`),
    areaTextStays: (pages, count) => `${count === 1 ? `A página ${pages} tem` : `As páginas ${pages} têm`} texto dentro de um padrão ou de uma máscara: uma zona oculta pinta-o de preto, mas esse texto continua no que o DocCloak analisa. Verifique o ficheiro transferido.`,
  },
  sv: {
    title: 'Sidor',
    hint: 'Uteslut sidor eller dölj områden för hand',
    pagesLeftOut: (count) => (count === 1 ? '1 sida utesluten' : `${count} sidor uteslutna`),
    areasHidden: (count) => (count === 1 ? '1 område dolt' : `${count} områden dolda`),
    undoAll: 'Ångra allt',
    note: 'En utesluten sida finns inte med i den nedladdade filen. Öppna en sida för att dölja ett område på den.',
    loading: 'Läser in sidorna...',
    failed: 'Sidorna kan inte visas.',
    pageOf: (page, total) => `Sida ${page} av ${total}`,
    openPage: (page) => `Öppna sida ${page} för att dölja områden`,
    leaveOut: 'Uteslut',
    bringBack: 'Ta med igen',
    leaveOutPage: (page) => `Uteslut sida ${page}`,
    bringBackPage: (page) => `Ta med sida ${page} igen`,
    leftOut: 'Utesluten',
    lastPage: 'Minst en sida måste vara kvar.',
    areaHelp: 'Dra över det du vill dölja. I den nedladdade filen målas området svart och dess text tas bort; en bokstav som området rör vid döljs helt. Sidan exporteras som en bild.',
    leftOutHelp: 'Den här sidan är utesluten: den finns inte med i den nedladdade filen.',
    addArea: 'Lägg till ett område',
    area: (index, total) => `Dolt område ${index} av ${total}`,
    removeArea: (index) => `Ta bort dolt område ${index}`,
    keysHint: 'Piltangenterna flyttar området, Skift med piltangenterna ändrar storleken, Delete tar bort det.',
    previous: 'Föregående sida',
    next: 'Nästa sida',
    close: 'Stäng',
    done: 'Klar',
    redactAgain: (redact) => `Text har kommit tillbaka i dokumentet, så listan över det som hittats har tömts. Klicka på "${redact}" igen.`,
    itemsGone: (count) => (count === 1 ? '1 träff försvann med texten som togs bort.' : `${count} träffar försvann med texten som togs bort.`),
    editFailed: 'Ändringen kunde inte göras. Inget ändrades.',
    exportLeftOut: (pages, count) => (count === 1 ? `Sidan ${pages} uteslöts: den finns inte i den här filen.` : `Sidorna ${pages} uteslöts: de finns inte i den här filen.`),
    exportAreas: (pages, count) => (count === 1 ? `Sidan ${pages}: de dolda områdena är svartmålade; sidan sparas som en bild med ett sökbart textlager.` : `Sidorna ${pages}: de dolda områdena är svartmålade; sidorna sparas som bilder med ett sökbart textlager.`),
    exportAreasNoText: (pages, count) => (count === 1 ? `Sidan ${pages}: de dolda områdena är svartmålade; sidan sparas som en bild och dess textlager är borta.` : `Sidorna ${pages}: de dolda områdena är svartmålade; sidorna sparas som bilder och deras textlager är borta.`),
    areaRefused: (pages, count) => (count === 1 ? `Sidan ${pages} kan inte sparas som en bild, så området på den kan inte döljas. Uteslut sidan eller ta bort området. Inget laddades ner.` : `Sidorna ${pages} kan inte sparas som bilder, så områdena på dem kan inte döljas. Uteslut sidorna eller ta bort områdena. Inget laddades ner.`),
    areaTextStays: (pages, count) => `${count === 1 ? `Sidan ${pages} har` : `Sidorna ${pages} har`} text i ett mönster eller en mask: ett dolt område målar den svart, men texten finns kvar i det DocCloak analyserar. Kontrollera den nedladdade filen.`,
  },
  no: {
    title: 'Sider',
    hint: 'Utelat sider eller skjul områder for hånd',
    pagesLeftOut: (count) => (count === 1 ? '1 side utelatt' : `${count} sider utelatt`),
    areasHidden: (count) => (count === 1 ? '1 område skjult' : `${count} områder skjult`),
    undoAll: 'Angre alt',
    note: 'En utelatt side er ikke med i den nedlastede filen. Åpne en side for å skjule et område på den.',
    loading: 'Laster inn sidene...',
    failed: 'Sidene kan ikke vises.',
    pageOf: (page, total) => `Side ${page} av ${total}`,
    openPage: (page) => `Åpne side ${page} for å skjule områder`,
    leaveOut: 'Utelat',
    bringBack: 'Ta med igjen',
    leaveOutPage: (page) => `Utelat side ${page}`,
    bringBackPage: (page) => `Ta med side ${page} igjen`,
    leftOut: 'Utelatt',
    lastPage: 'Minst én side må bli igjen.',
    areaHelp: 'Dra over det du vil skjule. I den nedlastede filen males området svart og teksten i det fjernes; en bokstav som området berører, skjules helt. Siden eksporteres som et bilde.',
    leftOutHelp: 'Denne siden er utelatt: den er ikke med i den nedlastede filen.',
    addArea: 'Legg til et område',
    area: (index, total) => `Skjult område ${index} av ${total}`,
    removeArea: (index) => `Fjern skjult område ${index}`,
    keysHint: 'Piltastene flytter området, Shift med piltastene endrer størrelsen, Delete fjerner det.',
    previous: 'Forrige side',
    next: 'Neste side',
    close: 'Lukk',
    done: 'Ferdig',
    redactAgain: (redact) => `Det har kommet tekst tilbake i dokumentet, så listen over funn er tømt. Klikk på «${redact}» igjen.`,
    itemsGone: (count) => (count === 1 ? '1 funn forsvant med teksten som ble tatt ut.' : `${count} funn forsvant med teksten som ble tatt ut.`),
    editFailed: 'Endringen kunne ikke gjøres. Ingenting ble endret.',
    exportLeftOut: (pages, count) => (count === 1 ? `Side ${pages} ble utelatt: den er ikke med i denne filen.` : `Sidene ${pages} ble utelatt: de er ikke med i denne filen.`),
    exportAreas: (pages, count) => (count === 1 ? `Side ${pages}: de skjulte områdene er malt svarte; siden lagres som et bilde med et søkbart tekstlag.` : `Sidene ${pages}: de skjulte områdene er malt svarte; sidene lagres som bilder med et søkbart tekstlag.`),
    exportAreasNoText: (pages, count) => (count === 1 ? `Side ${pages}: de skjulte områdene er malt svarte; siden lagres som et bilde, og tekstlaget er borte.` : `Sidene ${pages}: de skjulte områdene er malt svarte; sidene lagres som bilder, og tekstlaget deres er borte.`),
    areaRefused: (pages, count) => (count === 1 ? `Side ${pages} kan ikke lagres som et bilde, så området på den kan ikke skjules. Utelat siden eller fjern området. Ingenting ble lastet ned.` : `Sidene ${pages} kan ikke lagres som bilder, så områdene på dem kan ikke skjules. Utelat sidene eller fjern områdene. Ingenting ble lastet ned.`),
    areaTextStays: (pages, count) => `${count === 1 ? `Side ${pages} har` : `Sidene ${pages} har`} tekst i et mønster eller en maske: et skjult område maler den svart, men teksten blir værende i det DocCloak analyserer. Kontroller den nedlastede filen.`,
  },
};
