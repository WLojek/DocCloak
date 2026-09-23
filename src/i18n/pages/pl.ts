import type { PagesTranslations } from './types.ts';

export const pagesPl: PagesTranslations = {
  nav: {
    openApp: 'Otwórz aplikację',
    backHome: 'Strona główna DocCloak',
    gdprLink: 'DocCloak a RODO',
    useCasesLabel: 'Kto korzysta z DocCloak',
    lawyersLink: 'Dla prawników',
    accountantsLink: 'Dla księgowych',
    hrLink: 'Dla działów HR',
    researchersLink: 'Dla badaczy',
    plLandingLink: 'DocCloak po polsku',
    footerDisclaimer: 'Te strony opisują, jak działa DocCloak i jak ta architektura może wspierać Twoją pracę nad zgodnością z przepisami. Nie stanowią porady prawnej.',
    language: 'Język',
  },


  gdpr: {
    eyebrow: 'Zaufanie i zgodność',
    title: 'Jak DocCloak wspiera Twoją pracę nad zgodnością z RODO',
    intro: 'DocCloak opiera się na jednej decyzji architektonicznej: dane osobowe są wykrywane i zastępowane na Twoim urządzeniu, w Twojej przeglądarce, i nigdy do nas nie trafiają. Ta strona tłumaczy tę architekturę na pojęcia RODO, którymi posługują się inspektor ochrony danych, klienci i Twoje własne analizy ryzyka - prostym językiem.',
    disclaimerTitle: 'Czym ta strona jest, a czym nie jest',
    disclaimerBody: 'Ta strona wyjaśnia, jak działa DocCloak, abyś mógł ocenić narzędzie w ramach własnego systemu zgodności. Nie jest poradą prawną, a samo użycie DocCloak nie czyni żadnego procesu zgodnym z RODO. To, czy konkretne zastosowanie spełnia konkretny wymóg prawny, zależy od Twoich danych, Twojego procesu i polityk Twojej organizacji. Pokaż tę stronę swojemu IOD lub prawnikowi - zamiast ich pomijać.',
    archHeading: 'Architektura w jednym akapicie',
    archBody: 'DocCloak nie ma żadnego serwera dla Twoich treści. Modele wykrywania pobierane są raz z publicznego CDN, a następnie działają w Twojej przeglądarce przez WebAssembly. Twój tekst i pliki są przetwarzane na Twoim komputerze, mapowanie zamienników zostaje na Twoim komputerze, a nic, co wkleisz lub wgrasz, nie jest przez DocCloak nigdzie przesyłane. Nie ma konta, analityki ani telemetrii. Kod źródłowy jest publiczny na licencji AGPL-3.0.',
    verifyHeading: 'Możesz to sprawdzić samodzielnie',
    verifySteps: [
      'Otwórz narzędzia deweloperskie przeglądarki (F12 lub Cmd+Option+I) i przejdź do zakładki Sieć (Network).',
      'Wklej dokument do DocCloak i uruchom redakcję.',
      'Obserwuj: zero żądań sieciowych podczas przetwarzania tekstu. Po jednorazowym pobraniu modelu DocCloak działa nawet offline.',
      'Przeczytaj kod, który dotyka Twojego tekstu: jest otwarty na GitHubie na licencji AGPL-3.0.',
    ],
    mapHeading: 'Architektura przełożona na pojęcia RODO',
    mapIntro: 'Każdy wiersz zawiera weryfikowalny fakt o działaniu DocCloak oraz pojęcie RODO, którego ten fakt dotyczy. Mapowanie odzwierciedla naszą interpretację własnej architektury; jego znaczenie dla Twojego przypadku potwierdź we własnym procesie zgodności.',
    mappings: [
      {
        fact: 'Całe przetwarzanie odbywa się lokalnie, zanim jakiekolwiek dane mogłyby opuścić Twoje urządzenie',
        concept: 'Ochrona danych w fazie projektowania i domyślna ochrona danych (art. 25 RODO)',
        explanation: 'Artykuł 25 wymaga od administratorów wbudowania ochrony danych w projekt przetwarzania i uczynienia opcji ochronnej ustawieniem domyślnym. Wytyczne EROD 4/2019 w sprawie artykułu 25 (wersja 2.0, przyjęte 20 października 2020 r.) wskazują minimalizowanie ilości danych osobowych, zakresu ich przetwarzania i ich dostępności jako elementy projektowe tego obowiązku. Przetwarzanie wyłącznie lokalne jest takim elementem w najmocniejszej formie: zachowanie ochronne nie jest ustawieniem, które trzeba włączyć, lecz jedynym zachowaniem, jakie to narzędzie ma.',
      },
      {
        fact: 'Identyfikatory są zastępowane etykietami, a klucz mapowania zostaje na Twoim urządzeniu',
        concept: 'Pseudonimizacja (art. 4 pkt 5, art. 32 ust. 1 lit. a RODO)',
        explanation: 'RODO definiuje pseudonimizację jako przetworzenie danych osobowych tak, by nie można ich było przypisać osobie bez dodatkowych informacji przechowywanych osobno. Etykiety DocCloak z lokalnym mapowaniem do przywracania odpowiadają tej konstrukcji: przekazywany dalej tekst zawiera zamienniki, a dodatkowa informacja potrzebna do ponownego przypisania (mapowanie) nigdy nie opuszcza Twojego komputera. Artykuł 32 wprost wymienia pseudonimizację jako środek bezpieczeństwa. Uwaga na drugą stronę medalu: dane spseudonimizowane pozostają danymi osobowymi w rozumieniu motywu 26 - dlatego tak ważny jest opisany niżej etap przeglądu.',
      },
      {
        fact: 'Dalej kopiowany jest wyłącznie zredagowany tekst, który zatwierdzisz; reszta zostaje lokalnie',
        concept: 'Minimalizacja danych (art. 5 ust. 1 lit. c RODO)',
        explanation: 'Artykuł 5 ust. 1 lit. c wymaga, by dane osobowe były adekwatne, stosowne i ograniczone do tego, co niezbędne. Gdy korzystasz z zewnętrznej usługi AI, DocCloak pozwala ujawnić treść dokumentu, zatrzymując identyfikatory, których AI nie potrzebuje. To Ty decydujesz, pozycja po pozycji, co opuszcza Twój ekran.',
      },
      {
        fact: 'Nic nie jest przechowywane między sesjami; zamknięcie karty usuwa dokument i mapowanie',
        concept: 'Ograniczenie przechowywania (art. 5 ust. 1 lit. e RODO)',
        explanation: 'DocCloak nie zachowuje kopii Twoich treści: nie istnieje żadne przechowywanie po stronie serwera, a lokalnie zapisywane są jedynie ustawienia. Dla samego etapu anonimizacji nie ma retencji, którą trzeba by planować, minimalizować czy audytować.',
      },
      {
        fact: 'Twoje dokumenty nigdy nie trafiają do operatora DocCloak',
        concept: 'Brak nowego podmiotu przetwarzającego Twoje treści',
        explanation: 'Chmurowa usługa anonimizacji staje się podmiotem przetwarzającym dokładnie te dane, które próbujesz chronić - a to oznacza umowę powierzenia do podpisania, dostawcę do audytu i transfer do uzasadnienia. Ponieważ operator DocCloak nigdy nie otrzymuje Twoich treści, na tym etapie nie ma przetwarzania po naszej stronie, które wymagałoby umowy. Twój IOD może zweryfikować to twierdzenie technicznie, w zakładce Sieć, zamiast kontraktowo.',
      },
    ],
    dpiaHeading: 'Jak to wspiera odpowiedź w ocenie skutków (DPIA)',
    dpiaIntro: 'Jeśli Twoja organizacja przeprowadza ocenę skutków dla ochrony danych (art. 35 RODO) dla procesu, w którym dokumenty trafiają do generatywnej AI, DocCloak dostarcza konkretnych, weryfikowalnych stwierdzeń do sekcji środków ograniczających ryzyko:',
    dpiaPoints: [
      'Dane osobowe w dokumencie są pseudonimizowane lokalnie, na urządzeniu użytkownika, zanim cokolwiek zostanie ujawnione dostawcy AI.',
      'Klucz reidentyfikacji (mapowanie etykiet) nigdy nie opuszcza urządzenia i jest niszczony wraz z końcem sesji.',
      'Każde ujawnienie poprzedza etap przeglądu przez człowieka: wszystkie wykrycia są wylistowane i można je edytować, uzupełniać lub usuwać przed skopiowaniem tekstu.',
      'Samo narzędzie anonimizujące nie przesyła żadnych treści; można to zweryfikować w inspektorze sieciowym przeglądarki oraz w opublikowanym kodzie źródłowym AGPL-3.0.',
      'Jakość wykrywania jest mierzona i publikowana: każdy model testujemy na korpusie w 14 językach, z rygorystyczną metryką „wszystko albo nic", a metodologię i wyniki publikujemy.',
    ],
    dpiaOutro: 'Co pozostaje po Twojej stronie: ocena resztkowego ryzyka identyfikacji w tekście, który mimo wszystko jest wysyłany (kontekst potrafi zidentyfikować osobę nawet bez nazwiska), podstawa prawna całego procesu oraz przetwarzanie i transfery po stronie samego dostawcy AI. DocCloak ogranicza to, co ujawniasz; nie ocenia, po co to ujawniasz.',
    limitsHeading: 'Uczciwe ograniczenia',
    limitsIntro: 'Strona zaufania, która wymienia same mocne strony, jest stroną reklamową. Oto ograniczenia, które powinny znaleźć się w Twojej ocenie:',
    limits: [
      'Żaden detektor nie wykrywa 100% danych osobowych - i nie ufaj narzędziu, które twierdzi inaczej. DocCloak pokazuje każde wykrycie do przeglądu właśnie dlatego, że model może coś pominąć.',
      'Tekst z etykietami jest spseudonimizowany, a nie zanonimizowany w rozumieniu motywu 26. Tekst swobodny może identyfikować osobę przez sam kontekst; etap przeglądu służy ocenie tego resztkowego ryzyka.',
      'DocCloak obejmuje etap ujawnienia w Twoim procesie. Nie czyni zgodną usługi AI, z której korzystasz, i nie zastępuje rejestru czynności przetwarzania, podstawy prawnej ani DPIA.',
      'Jednorazowe pobranie modelu następuje z publicznego CDN. Potem przetwarzanie jest w pełni lokalne i działa offline.',
    ],
    refsHeading: 'Źródła',
    refsIntro: 'Przepisy i wytyczne przywołane na tej stronie:',
    refs: [
      'Rozporządzenie (UE) 2016/679 (RODO): art. 4 pkt 5 (definicja pseudonimizacji), art. 5 ust. 1 lit. c (minimalizacja danych), art. 5 ust. 1 lit. e (ograniczenie przechowywania), art. 25 (ochrona danych w fazie projektowania i domyślna ochrona danych), art. 32 ust. 1 lit. a (bezpieczeństwo przetwarzania), art. 35 (ocena skutków dla ochrony danych), motywy 26 i 28.',
      'Europejska Rada Ochrony Danych (EROD/EDPB), Wytyczne 4/2019 w sprawie artykułu 25: ochrona danych w fazie projektowania oraz domyślna ochrona danych, wersja 2.0, przyjęte 20 października 2020 r.',
    ],
    ctaHeading: 'Zobacz na własne oczy',
    ctaBody: 'Najszybszy sposób oceny DocCloak: otwórz aplikację z uruchomionymi DevTools i patrz, jak zakładka Sieć pozostaje pusta.',
    ctaApp: 'Otwórz DocCloak',
    ctaUseCases: 'Zobacz zastosowania w zawodach',
  },

  useCases: {
    lawyers: {
      eyebrow: 'DocCloak dla prawników',
      title: 'Korzystaj z AI w sprawach klientów bez ujawniania ich danych',
      intro: 'Samorządy prawnicze po obu stronach Atlantyku mówią o generatywnej AI to samo: obowiązek zachowania tajemnicy zawodowej obowiązuje, zanim cokolwiek trafi do promptu (zob. np. opinię formalną ABA nr 512 z lipca 2024 r. o narzędziach generatywnej AI). DocCloak to praktyczna odpowiedź na ten obowiązek: pseudonimizujesz dokument w przeglądarce, wysyłasz AI wersję z zamiennikami, a w odpowiedzi przywracasz prawdziwe nazwiska. Tożsamość klienta nigdy nie trafia do usługi AI.',
      workflowHeading: 'Konkretny scenariusz: analiza umowy',
      steps: [
        { title: 'Wczytaj umowę', body: 'Wklej tekst albo przeciągnij plik .docx. Formatowanie zostaje zachowane w zredagowanym pliku do pobrania. Wszystko dzieje się w Twojej przeglądarce.' },
        { title: 'Zredaguj i sprawdź', body: 'DocCloak wykrywa strony umowy, sygnatariuszy, adresy, numery kont i sygnatury akt, a każdy podmiot oznacza spójnie: „Kowalski" staje się tym samym [PERSON_1] w każdej klauzuli. Przejrzyj listę, popraw ewentualne braki i dodaj do słownika terminy specyficzne dla kancelarii.' },
        { title: 'Zapytaj AI', body: 'Skopiuj spseudonimizowaną umowę do ChatGPT, Claude lub Gemini i poproś o analizę klauzul, podsumowanie ryzyk albo propozycje zmian. AI pracuje na [PERSON_1] i [COMPANY_2], nie na Twoim kliencie.' },
        { title: 'Przywróć', body: 'Wklej odpowiedź AI z powrotem do DocCloak. Etykiety wracają do prawdziwych nazwisk, a efekt pracy wygląda tak, jakby nic nie było maskowane.' },
      ],
      catchesHeading: 'Stworzone do dokumentów prawnych',
      catchesIntro: 'Poza nazwiskami, e-mailami i adresami warstwa wykrywania obejmuje reguły istotne w praktyce prawniczej, w tym polski pakiet reguł:',
      catches: [
        'Nazwiska stron i sygnatariuszy, oznaczane spójnie w całym dokumencie',
        'Sygnatury akt sądowych (np. „III K 123/24") oraz numery rejestrowe KRS',
        'Nazwy spółek z formą prawną (Sp. z o.o., S.A.), NIP i REGON',
        'Numery kont bankowych, IBAN-y i kwoty, także zapisane słownie po „słownie:"',
        'Własny słownik: nazwy spraw, kryptonimy, każdy termin, który kancelaria traktuje jako poufny',
      ],
      scopeHeading: 'Uczciwy zakres',
      scopeIntro: 'Decyduj z otwartymi oczami:',
      scope: [
        'Żaden detektor nie wykrywa 100%. Tabela przeglądu istnieje dlatego, że model może coś pominąć; to prawnik, nie narzędzie, zatwierdza, co opuszcza ekran.',
        'Spseudonimizowany tekst wciąż może identyfikować klienta przez kontekst (unikalny stan faktyczny też jest identyfikatorem). W sprawach, w których tajemnicą są same fakty, redakcja identyfikatorów może nie wystarczyć.',
        'DocCloak porządkuje to, co ujawniasz AI. Zasady wykonywania zawodu dotyczące korzystania z AI, nadzoru i komunikacji z klientem nadal obowiązują w pozostałej części procesu.',
      ],
      proofHeading: 'Dowody, nie obietnice',
      proofBody: 'Nasze modele testujemy na własnym korpusie w 14 językach (112 dokumentów, 1007 oznaczonych identyfikatorów) z rygorystyczną metryką: wykrycie liczy się tylko wtedy, gdy zamaskowany jest każdy znak identyfikatora. Najlepszy model w naszych opublikowanych testach osiągnął 98,6% czułości (strict recall) dla języka polskiego i 97,0% łącznie dla wszystkich 14 języków. Pełna metodologia i tabele per język są opublikowane w otwartym repozytorium.',
      proofNote: 'Wynik zmierzony na naszym własnym korpusie testowym, wyłącznie dla wyjścia modelu. Rezultat na Twoich dokumentach zależy od treści, języka i ustawień. Właśnie dlatego istnieje etap przeglądu.',
    },

    accountants: {
      eyebrow: 'DocCloak dla księgowych',
      title: 'Pytaj AI o liczby, nie o swoich klientów',
      intro: 'Praca biura rachunkowego to strumień dokumentów pełnych dokładnie tych danych, które nie mogą wyciec: PESEL, NIP, numery kont, wynagrodzenia, nazwiska klientów. AI naprawdę pomaga pisać pisma do klientów, tłumaczyć przepisy i streszczać dokumenty - ale tylko wtedy, gdy to, co wklejasz, jest czyste. DocCloak usuwa identyfikatory w Twojej przeglądarce, zanim tekst gdziekolwiek trafi.',
      workflowHeading: 'Konkretny scenariusz: pismo do klienta w sprawie decyzji podatkowej',
      steps: [
        { title: 'Wklej dokument', body: 'Decyzję podatkową, sporną fakturę, pytanie kadrowo-płacowe. Tekst, plik .docx albo zdjęcie czy skan pisma: tekst z obrazów jest odczytywany lokalnie (OCR).' },
        { title: 'Zredaguj i sprawdź', body: 'DocCloak wykrywa nazwiska, numery PESEL, NIP i REGON, numery kont bankowych, adresy i kwoty, a każde wykrycie pokazuje na liście do Twojego przeglądu. Polski pakiet reguł zna krajowe formaty identyfikatorów.' },
        { title: 'Redaguj z AI', body: 'Poproś AI o streszczenie decyzji, projekt odpowiedzi albo wyjaśnienie przepisu - na tekście, w którym Twój klient to [PERSON_1] z kontem [OTHER_2].' },
        { title: 'Przywróć i wyślij', body: 'Wklej projekt od AI z powrotem. Prawdziwe nazwiska i numery wracają, a pismo jest gotowe do Twojej weryfikacji i podpisu.' },
      ],
      catchesHeading: 'Stworzone do dokumentów finansowych',
      catchesIntro: 'Warstwa wykrywania łączy model ML z regułami regionalnymi, co w pracy z dokumentami finansowymi oznacza m.in.:',
      catches: [
        'PESEL, NIP, REGON i KRS (polski pakiet reguł)',
        'Numery kont bankowych (26 cyfr) i IBAN-y',
        'Kwoty, w tym zapisane słownie po „słownie:"',
        'Nazwy firm z formą prawną (Sp. z o.o., S.A., Sp. k.)',
        'E-maile, telefony i adresy pocztowe klientów oraz kontrahentów',
      ],
      scopeHeading: 'Uczciwy zakres',
      scopeIntro: 'Decyduj z otwartymi oczami:',
      scope: [
        'Żaden detektor nie wykrywa 100%. Każde wykrycie trafia na listę do przeglądu i to Ty zatwierdzasz, co opuszcza ekran.',
        'Aplikacja webowa przetwarza tekst i pojedyncze dokumenty. Nie przetwarza arkuszy kalkulacyjnych.',
        'Usunięcie identyfikatorów to jeden środek ochrony, nie cały program zgodności. Warunki umowy z klientem i tajemnica zawodowa nadal rozstrzygają, co w ogóle wolno udostępniać.',
      ],
      proofHeading: 'Dowody, nie obietnice',
      proofBody: 'Nasze modele testujemy na własnym korpusie w 14 językach (112 dokumentów, 1007 oznaczonych identyfikatorów) z rygorystyczną metryką: wykrycie liczy się tylko wtedy, gdy zamaskowany jest każdy znak identyfikatora. Najlepszy model w naszych opublikowanych testach osiągnął 98,6% czułości (strict recall) dla języka polskiego i 97,0% łącznie dla wszystkich 14 języków. Pełna metodologia i tabele per język są opublikowane w otwartym repozytorium.',
      proofNote: 'Wynik zmierzony na naszym własnym korpusie testowym, wyłącznie dla wyjścia modelu. Rezultat na Twoich dokumentach zależy od treści, języka i ustawień. Właśnie dlatego istnieje etap przeglądu.',
    },

    hr: {
      eyebrow: 'DocCloak dla działów HR',
      title: 'Praca z AI w HR bez danych pracowników w promptach',
      intro: 'HR siedzi na najwrażliwszych danych w firmie: wynagrodzenia, zwolnienia lekarskie, notatki z ocen, spory. To zarazem dział z największą ilością pisania, w którym AI pomaga codziennie. DocCloak pozwala używać AI do polityk, pism i podsumowań, podczas gdy tożsamości pracowników zostają na Twoim komputerze.',
      workflowHeading: 'Konkretny scenariusz: podsumowanie sprawy pracowniczej',
      steps: [
        { title: 'Wklej notatki ze sprawy', body: 'Notatki ze spotkań, treść skargi albo plik .docx. Nic nie jest wysyłane; przetwarzanie odbywa się w Twojej przeglądarce.' },
        { title: 'Zredaguj i sprawdź', body: 'Nazwiska, daty urodzenia, adresy, numery PESEL i kwoty wynagrodzeń są wykrywane i zastępowane typowanymi etykietami. Ten sam pracownik pozostaje [PERSON_1] w całym tekście, więc AI nadal rozumie, kto co zrobił.' },
        { title: 'Pracuj z AI', body: 'Poproś o neutralne podsumowanie sprawy, pierwszy projekt pisma z rozstrzygnięciem albo porównanie z polityką firmy. AI widzi role i zdarzenia, nie ludzi.' },
        { title: 'Przywróć', body: 'Wklej wynik z powrotem do DocCloak, a prawdziwe nazwiska wrócą do finalnego dokumentu.' },
      ],
      catchesHeading: 'Stworzone do danych o ludziach',
      catchesIntro: 'Wykrycia istotne w dokumentach HR to m.in.:',
      catches: [
        'Nazwiska, oznaczane spójnie, dzięki czemu sprawy wieloosobowe pozostają czytelne po maskowaniu',
        'Numery PESEL i numery dowodów osobistych, daty oraz adresy',
        'Kwoty wynagrodzeń i numery kont bankowych',
        'E-maile i numery telefonów',
        'Własne etykiety i słownik terminów wewnętrznych: kryptonimy projektów, nazwy lokalizacji, wszystko, co w Twojej organizacji identyfikuje',
      ],
      scopeHeading: 'Uczciwy zakres',
      scopeIntro: 'Decyduj z otwartymi oczami:',
      scope: [
        'Żaden detektor nie wykrywa 100%, a teksty HR są pełne identyfikatorów pośrednich („jedyny programista na nocnej zmianie"). Etap przeglądu służy wyłapaniu tego, czego model nie potrafi.',
        'Mały zespół łatwo zidentyfikować z kontekstu nawet po zamaskowaniu nazwisk. W sprawach dotyczących kilku osób oceń resztkowe ryzyko, zanim cokolwiek wyślesz.',
        'DocCloak obsługuje etap ujawnienia. To, czy AI w ogóle wolno stosować do danej kategorii danych HR, jest decyzją polityki Twojej organizacji, często z udziałem IOD lub przedstawicieli pracowników.',
      ],
      proofHeading: 'Dowody, nie obietnice',
      proofBody: 'Nasze modele testujemy na własnym korpusie w 14 językach (112 dokumentów, 1007 oznaczonych identyfikatorów) z rygorystyczną metryką: wykrycie liczy się tylko wtedy, gdy zamaskowany jest każdy znak identyfikatora. Najlepszy model w naszych opublikowanych testach osiągnął 98,6% czułości (strict recall) dla języka polskiego i 97,0% łącznie dla wszystkich 14 języków. Pełna metodologia i tabele per język są opublikowane w otwartym repozytorium.',
      proofNote: 'Wynik zmierzony na naszym własnym korpusie testowym, wyłącznie dla wyjścia modelu. Rezultat na Twoich dokumentach zależy od treści, języka i ustawień. Właśnie dlatego istnieje etap przeglądu.',
    },

    researchers: {
      eyebrow: 'DocCloak dla badaczy',
      title: 'Pseudonimizuj wywiady i ankiety, zanim dotknie ich AI',
      intro: 'Badania jakościowe żyją transkrypcjami i odpowiedziami otwartymi, a zgody komisji etycznych żyją obietnicami o tym, jak te dane będą traktowane. DocCloak pozwala używać AI do wspomagania kodowania, streszczeń i roboczych tłumaczeń na spseudonimizowanym tekście, przetwarzanym w całości na Twoim komputerze - a to zdanie można wpisać do planu zarządzania danymi i potem zademonstrować.',
      workflowHeading: 'Konkretny scenariusz: kodowanie transkrypcji wywiadu',
      steps: [
        { title: 'Wklej transkrypcję', body: 'Zwykły tekst albo .docx. W przypadku skanów lub sfotografowanych notatek tekst jest odczytywany lokalnie (OCR).' },
        { title: 'Zredaguj i sprawdź', body: 'Nazwiska uczestników, miejscowości, pracodawcy i inne identyfikatory są zastępowane spójnymi etykietami: ten sam rozmówca pozostaje [PERSON_1] w całej transkrypcji, więc wypowiedzi dają się przypisać w obrębie dokumentu, ale nie do osoby.' },
        { title: 'Analizuj z AI', body: 'Poproś o wstępne tematy, podsumowanie per rozmówca albo roboczy przekład. AI pracuje na spseudonimizowanej transkrypcji.' },
        { title: 'Przywróć w razie potrzeby', body: 'Jeśli notatki analityczne muszą wrócić do prawdziwych tożsamości na potrzeby Twojej dokumentacji, wklej je do DocCloak i przywróć. Mapowanie nigdy nie opuściło Twojego urządzenia.' },
      ],
      catchesHeading: 'Stworzone do tekstów badawczych',
      catchesIntro: 'Wykrycia przydatne w materiale badawczym to m.in.:',
      catches: [
        'Nazwiska uczestników i osób trzecich, oznaczane spójnie w całej transkrypcji',
        'Miejscowości, pracodawcy i nazwy organizacji zawężające krąg rozmówców',
        'Dane kontaktowe, numery identyfikacyjne i daty',
        'Własne etykiety: zdefiniuj swoje typy (nazwa przychodni, szkoła, wieś), a model zero-shot będzie ich szukał',
        'Słownik terminów specyficznych dla badania, które zawsze mają być maskowane',
      ],
      scopeHeading: 'Uczciwy zakres',
      scopeIntro: 'Decyduj z otwartymi oczami:',
      scope: [
        'Żaden detektor nie wykrywa 100%, a mowa z wywiadów identyfikuje ludzi przez historie, nie tylko nazwiska. Przegląd wykryć jest częścią metody, nie opcjonalnym dodatkiem.',
        'Spseudonimizowane to nie zanonimizowane: w świetle motywu 26 RODO dane, które można ponownie powiązać kluczem będącym w Twoim posiadaniu, pozostają danymi osobowymi. Opisz to precyzyjnie we wniosku do komisji.',
        'Czy Twoja zgoda etyczna w ogóle dopuszcza przetwarzanie przez zewnętrzną AI, rozstrzyga komisja; DocCloak minimalizuje to, co takie przetwarzanie by zobaczyło, ale nie odpowiada na pytanie o dopuszczalność.',
      ],
      proofHeading: 'Dowody, nie obietnice',
      proofBody: 'Nasze modele testujemy na własnym korpusie w 14 językach (112 dokumentów, 1007 oznaczonych identyfikatorów) z rygorystyczną metryką: wykrycie liczy się tylko wtedy, gdy zamaskowany jest każdy znak identyfikatora. Najlepszy model w naszych opublikowanych testach osiągnął 98,6% czułości (strict recall) dla języka polskiego i 97,0% łącznie dla wszystkich 14 języków. Pełna metodologia i tabele per język są opublikowane w otwartym repozytorium.',
      proofNote: 'Wynik zmierzony na naszym własnym korpusie testowym, wyłącznie dla wyjścia modelu. Rezultat na Twoich dokumentach zależy od treści, języka i ustawień. Właśnie dlatego istnieje etap przeglądu.',
    },
  },
};

/**
 * Content of the Polish-language landing page (route #/pl).
 *
 * This is NOT a translation of an English page: it is native Polish
 * marketing copy for the Polish market ("global product, Polish beachhead"),
 * so it lives here as its own structure instead of inside PagesTranslations.
 */
export interface PlLandingContent {
  metaTitle: string;
  hero: {
    title1: string;
    titleMark: string;
    title2: string;
    subtitle: string;
    emphasis: string;
    ctaApp: string;
    ctaGdpr: string;
  };
  trust: string[];
  demo: {
    heading: string;
    beforeLabel: string;
    afterLabel: string;
    before: string;
    after: string;
    caption: string;
  };
  polish: {
    heading: string;
    intro: string;
    items: string[];
    outro: string;
  };
  benchmark: {
    heading: string;
    stat: string;
    statLabel: string;
    body: string;
    footnote: string;
  };
  audience: {
    heading: string;
    cards: { title: string; body: string; href: string; linkLabel: string }[];
  };
  rodo: {
    heading: string;
    body: string;
    linkLabel: string;
  };
  cta: {
    heading: string;
    body: string;
    app: string;
  };
}

export const plLanding: PlLandingContent = {
  metaTitle: 'DocCloak - anonimizacja dokumentów w przeglądarce, zanim trafią do AI',
  hero: {
    title1: 'Korzystaj z AI.',
    titleMark: 'PESEL, NIP i nazwiska',
    title2: 'zostają u Ciebie.',
    subtitle: 'DocCloak zamienia dane osobowe w Twoim tekście na bezpieczne etykiety bezpośrednio w przeglądarce, zanim cokolwiek trafi do ChatGPT, Claude czy Gemini. Wklejasz odpowiedź AI z powrotem, a prawdziwe dane wracają na miejsce.',
    emphasis: 'Żaden dokument nie opuszcza Twojego komputera.',
    ctaApp: 'Wypróbuj za darmo',
    ctaGdpr: 'DocCloak a RODO',
  },
  trust: [
    '100% w Twojej przeglądarce, bez wysyłania plików',
    'Open source · AGPL-3.0',
    'Bez konta, bez śledzenia, bez telemetrii',
    'Darmowe, bez limitu dokumentów',
  ],
  demo: {
    heading: 'Przed i po',
    beforeLabel: 'Twój dokument',
    afterLabel: 'To, co widzi AI',
    before: 'Klient: Jan Kowalski, PESEL 85010212345, dowód osobisty ABC123456, zam. ul. Lipowa 7/2, 30-001 Kraków, NIP 6750000000. Proszę o analizę załączonej umowy najmu i wskazanie ryzyk.',
    after: 'Klient: [PERSON_1], PESEL [SSN_1], dowód osobisty [SSN_2], zam. [ADDRESS_1], NIP [SSN_3]. Proszę o analizę załączonej umowy najmu i wskazanie ryzyk.',
    caption: 'Dane w przykładzie są fikcyjne. Każde wykrycie widzisz na liście i możesz je poprawić, zanim skopiujesz tekst. Po odpowiedzi AI jedno kliknięcie przywraca prawdziwe dane.',
  },
  polish: {
    heading: 'Zna polskie dokumenty',
    intro: 'Oprócz wielojęzycznego modelu ML DocCloak ma dedykowany polski pakiet reguł. Wykrywa m.in.:',
    items: [
      'PESEL',
      'NIP i REGON',
      'numer dowodu osobistego i paszportu',
      'KRS',
      'numer konta bankowego (26 cyfr)',
      'sygnatury akt sądowych (np. „III K 123/24")',
      'adresy, kody pocztowe, telefony',
      'nazwy spółek z formą prawną (Sp. z o.o., S.A.)',
      'kwoty zapisane słownie po „słownie:"',
    ],
    outro: 'Do tego własne etykiety i słownik: dodaj nazwę sprawy, kryptonim projektu albo nazwisko, które zawsze ma być maskowane.',
  },
  benchmark: {
    heading: 'Zmierzone, nie obiecane',
    stat: '98,6%',
    statLabel: 'czułości wykrywania (strict recall) dla języka polskiego w naszych testach',
    body: 'Nie prosimy o zaufanie na słowo. Każdy model testujemy na własnym korpusie w 14 językach (112 dokumentów, 1007 oznaczonych danych osobowych) z metryką „wszystko albo nic": wykrycie liczy się tylko wtedy, gdy zamaskowany jest każdy znak identyfikatora. Metodologię i pełne wyniki publikujemy w otwartym repozytorium.',
    footnote: 'Najlepszy model w naszych opublikowanych testach (sierpień 2026), wynik wyłącznie dla wyjścia modelu na naszym korpusie testowym. Rezultat na Twoich dokumentach zależy od treści i ustawień; żaden detektor nie wykrywa 100% i dlatego każde wykrycie pokazujemy do przeglądu.',
  },
  audience: {
    heading: 'Dla kogo',
    cards: [
      {
        title: 'Kancelarie prawne',
        body: 'Analiza umów i pism procesowych z pomocą AI bez ujawniania danych klientów. Tajemnica zawodowa zostaje w kancelarii.',
        href: '#/for/lawyers',
        linkLabel: 'Zobacz scenariusz dla prawników',
      },
      {
        title: 'Biura rachunkowe',
        body: 'Pisma do klientów, streszczenia decyzji i pytania o przepisy - na tekście bez PESEL-i, NIP-ów i numerów kont.',
        href: '#/for/accountants',
        linkLabel: 'Zobacz scenariusz dla księgowych',
      },
      {
        title: 'Działy HR',
        body: 'Polityki, pisma i podsumowania spraw pracowniczych z pomocą AI, podczas gdy dane pracowników zostają na Twoim komputerze.',
        href: '#/for/hr',
        linkLabel: 'Zobacz scenariusz dla HR',
      },
      {
        title: 'Badacze',
        body: 'Pseudonimizacja transkrypcji wywiadów i ankiet przed analizą z AI - zgodnie z tym, co obiecano komisji etycznej.',
        href: '#/for/researchers',
        linkLabel: 'Zobacz scenariusz dla badaczy',
      },
    ],
  },
  rodo: {
    heading: 'A co z RODO?',
    body: 'Przetwarzanie wyłącznie lokalne to ochrona danych w fazie projektowania w najmocniejszej formie: nie ma serwera, któremu trzeba zaufać, umowy powierzenia dla samego etapu anonimizacji ani retencji do audytowania. Przygotowaliśmy stronę, która tłumaczy architekturę DocCloak na pojęcia RODO: art. 25, pseudonimizacja, minimalizacja danych i wsparcie odpowiedzi w DPIA. Bez żargonu i bez obietnic, których narzędzie nie może złożyć.',
    linkLabel: 'Przeczytaj: DocCloak a RODO',
  },
  cta: {
    heading: 'Sprawdź w 60 sekund',
    body: 'Otwórz aplikację, wklej fragment dokumentu i patrz w zakładkę Sieć w DevTools: zero żądań. Bez konta, bez instalacji, bez wysyłania czegokolwiek.',
    app: 'Otwórz DocCloak',
  },
};
