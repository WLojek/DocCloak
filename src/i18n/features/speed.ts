/**
 * Strings of the speed work (T280, WLojek/DocCloak.Core#5): the hint in the progress view, the
 * mark on a very large model, and the FAQ entry about background tabs.
 */
import type { FeatureStrings } from './index.ts';

export interface SpeedStrings {
  /** Under the progress bar while a document is analysed on the processor. */
  visibleTabHint: string;
  /** Next to the size of a model of a gigabyte or more, in red ("1.27 GB"). */
  largeDownload: (size: string) => string;
  /** Read out with the size by screen readers. */
  largeDownloadLabel: string;
  faqQuestion: string;
  faqAnswer: string;
}

export const speedStrings: FeatureStrings<SpeedStrings> = {
  en: {
    visibleTabHint: 'The analysis runs faster while this tab stays visible.',
    largeDownload: (size) => `${size} - large download`,
    largeDownloadLabel: 'Large download',
    faqQuestion: 'Why is the analysis slower when I switch to another tab?',
    faqAnswer: 'Browsers give a tab you are not looking at less processor time; in Chrome we measured about five times less. Keep the DocCloak tab visible while a document is analysed, for example in a window of its own next to your other work. The full-precision WebGPU model in the settings is not slowed down, because it runs on the graphics card. Chrome can also be told not to slow background tabs: start it with the switch --disable-renderer-backgrounding (it then applies to every tab and uses more battery), and an organisation can set Chrome\'s ForceForegroundPriorityForUrls policy for this site.',
  },
  pl: {
    visibleTabHint: 'Analiza działa szybciej, gdy ta karta jest widoczna.',
    largeDownload: (size) => `${size} - duży plik`,
    largeDownloadLabel: 'Duży plik do pobrania',
    faqQuestion: 'Dlaczego analiza zwalnia, gdy przechodzę do innej karty?',
    faqAnswer: 'Przeglądarki dają karcie, na którą nie patrzysz, mniej czasu procesora; w Chrome zmierzyliśmy około pięć razy mniej. Na czas analizy dokumentu zostaw kartę DocCloak widoczną, na przykład w osobnym oknie obok innej pracy. Model pełnej precyzji na WebGPU (w ustawieniach) nie zwalnia, bo liczy na karcie graficznej. Chrome można też ustawić tak, by nie spowalniał kart w tle: uruchom go z przełącznikiem --disable-renderer-backgrounding (działa wtedy na wszystkie karty i zużywa więcej baterii), a w firmie administrator może ustawić dla tej strony politykę Chrome ForceForegroundPriorityForUrls.',
  },
  de: {
    visibleTabHint: 'Die Analyse läuft schneller, solange dieser Tab sichtbar ist.',
    largeDownload: (size) => `${size} - großer Download`,
    largeDownloadLabel: 'Großer Download',
    faqQuestion: 'Warum wird die Analyse langsamer, wenn ich in einen anderen Tab wechsle?',
    faqAnswer: 'Browser geben einem Tab, den Sie nicht ansehen, weniger Prozessorzeit; in Chrome haben wir etwa fünfmal weniger gemessen. Lassen Sie den DocCloak-Tab sichtbar, solange ein Dokument analysiert wird, zum Beispiel in einem eigenen Fenster neben Ihrer übrigen Arbeit. Das WebGPU-Modell in voller Präzision (in den Einstellungen) wird nicht gebremst, weil es auf der Grafikkarte rechnet. Chrome lässt sich auch so starten, dass Tabs im Hintergrund nicht gebremst werden: mit dem Schalter --disable-renderer-backgrounding (gilt dann für alle Tabs und braucht mehr Akku); in Organisationen kann die Chrome-Richtlinie ForceForegroundPriorityForUrls für diese Seite gesetzt werden.',
  },
  fr: {
    visibleTabHint: 'L\'analyse est plus rapide tant que cet onglet reste visible.',
    largeDownload: (size) => `${size} - téléchargement volumineux`,
    largeDownloadLabel: 'Téléchargement volumineux',
    faqQuestion: 'Pourquoi l\'analyse ralentit-elle quand je passe à un autre onglet ?',
    faqAnswer: 'Les navigateurs accordent moins de temps de processeur à un onglet que vous ne regardez pas ; dans Chrome, nous avons mesuré environ cinq fois moins. Gardez l\'onglet DocCloak visible pendant l\'analyse d\'un document, par exemple dans une fenêtre à part à côté de votre travail. Le modèle WebGPU en pleine précision (dans les paramètres) n\'est pas ralenti, car il calcule sur la carte graphique. On peut aussi demander à Chrome de ne pas ralentir les onglets en arrière-plan : lancez-le avec l\'option --disable-renderer-backgrounding (elle vaut alors pour tous les onglets et consomme plus de batterie) ; une organisation peut définir pour ce site la stratégie Chrome ForceForegroundPriorityForUrls.',
  },
  es: {
    visibleTabHint: 'El análisis va más rápido mientras esta pestaña está visible.',
    largeDownload: (size) => `${size} - descarga grande`,
    largeDownloadLabel: 'Descarga grande',
    faqQuestion: '¿Por qué el análisis va más lento cuando cambio de pestaña?',
    faqAnswer: 'Los navegadores dan menos tiempo de procesador a una pestaña que no se está mirando; en Chrome medimos unas cinco veces menos. Deje la pestaña de DocCloak visible mientras se analiza un documento, por ejemplo en una ventana propia junto a su otro trabajo. El modelo WebGPU de precisión completa (en los ajustes) no se ralentiza, porque calcula en la tarjeta gráfica. También se puede pedir a Chrome que no ralentice las pestañas en segundo plano: inícielo con la opción --disable-renderer-backgrounding (vale entonces para todas las pestañas y gasta más batería); una organización puede fijar para este sitio la política de Chrome ForceForegroundPriorityForUrls.',
  },
  pt: {
    visibleTabHint: 'A análise é mais rápida enquanto este separador está visível.',
    largeDownload: (size) => `${size} - transferência grande`,
    largeDownloadLabel: 'Transferência grande',
    faqQuestion: 'Porque é que a análise fica mais lenta quando mudo de separador?',
    faqAnswer: 'Os navegadores dão menos tempo de processador a um separador que não está a ser visto; no Chrome medimos cerca de cinco vezes menos. Mantenha o separador do DocCloak visível enquanto um documento é analisado, por exemplo numa janela própria ao lado do resto do trabalho. O modelo WebGPU de precisão total (nas definições) não abranda, porque calcula na placa gráfica. Também é possível dizer ao Chrome para não abrandar os separadores em segundo plano: inicie-o com a opção --disable-renderer-backgrounding (passa a valer para todos os separadores e gasta mais bateria); uma organização pode definir para este site a política do Chrome ForceForegroundPriorityForUrls.',
  },
  sv: {
    visibleTabHint: 'Analysen går snabbare så länge den här fliken är synlig.',
    largeDownload: (size) => `${size} - stor nedladdning`,
    largeDownloadLabel: 'Stor nedladdning',
    faqQuestion: 'Varför går analysen långsammare när jag byter till en annan flik?',
    faqAnswer: 'Webbläsare ger en flik som du inte tittar på mindre processortid; i Chrome mätte vi ungefär fem gånger mindre. Låt DocCloak-fliken vara synlig medan ett dokument analyseras, till exempel i ett eget fönster bredvid ditt övriga arbete. WebGPU-modellen med full precision (i inställningarna) bromsas inte, eftersom den räknar på grafikkortet. Chrome kan också startas så att flikar i bakgrunden inte bromsas: med växeln --disable-renderer-backgrounding (den gäller då alla flikar och drar mer batteri); en organisation kan sätta Chrome-principen ForceForegroundPriorityForUrls för den här webbplatsen.',
  },
  no: {
    visibleTabHint: 'Analysen går raskere så lenge denne fanen er synlig.',
    largeDownload: (size) => `${size} - stor nedlasting`,
    largeDownloadLabel: 'Stor nedlasting',
    faqQuestion: 'Hvorfor går analysen saktere når jeg bytter til en annen fane?',
    faqAnswer: 'Nettlesere gir en fane du ikke ser på mindre prosessortid; i Chrome målte vi omtrent fem ganger mindre. La DocCloak-fanen være synlig mens et dokument analyseres, for eksempel i et eget vindu ved siden av det andre arbeidet ditt. WebGPU-modellen med full presisjon (i innstillingene) bremses ikke, fordi den regner på grafikkortet. Chrome kan også startes slik at faner i bakgrunnen ikke bremses: med bryteren --disable-renderer-backgrounding (den gjelder da alle faner og bruker mer batteri); en organisasjon kan sette Chrome-policyen ForceForegroundPriorityForUrls for dette nettstedet.',
  },
};
