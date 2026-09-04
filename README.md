# Toastmaster

En liten nettside som viser introduksjonstekstene våre, én taler om gangen, i stor
og lettlest skrift på mobil. Laget for å leses fra hånda mens man står foran forsamlingen.

Alt kjører i nettleseren. Teksten lastes opp lokalt og lagres bare på telefonen din
(`localStorage`) – ingenting sendes til noen server.

## Slik bruker du den

1. Åpne siden på mobilen.
2. Last opp dokumentet med introduksjonene (`.txt`, `.md` eller `.docx`), eller lim inn teksten.
3. Velg hvem du er – **Anders** eller **Fredrik**. Listen viser da bare dine introduksjoner
   (bytt til «Alle» for å se alt).
4. Trykk på taleren du skal introdusere. Teksten fylles skjermen.
5. Sveip sidelengs, eller bruk **Forrige / Neste**, for å bla mellom dine introduksjoner.
   **A− / A+** justerer tekststørrelsen, og den huskes til neste gang.

Skjermen holdes våken mens du står i lesevisningen (der nettleseren støtter det).
Legg gjerne siden til på hjemskjermen – da åpner den seg som en app, og fungerer
også uten nett etter første besøk.

## Format på dokumentet

Én overskrift per taler, og teksten under:

```
# Ola Nordmann (Anders)

Kjære alle sammen. Vår neste taler har vært med i klubben i tre år.

[vent til det blir stille]

Ta vel imot Ola Nordmann!

# Kari Nordmann
Leses av: Fredrik

Neste ut er en av dem som alltid får oss til å le.
```

- **Overskrift:** `# Navn`, `## Navn`, `[Navn]` eller `Taler: Navn`.
- **Hvem som leser:** i parentes etter navnet – `# Ola Nordmann (Anders)` – eller på egen
  linje rett under overskriften: `Leses av:`, `Leser:`, `Toastmaster:`, `Intro av:` eller `Av:`.
  Er ikke leser angitt, kan du trykke på merkelappen til høyre i listen for å sette den i appen.
- **Regibeskjeder:** et avsnitt i `[hakeparentes]` vises mindre og i uthevingsfarge,
  f.eks. `[vent på applaus]` – nyttig for beskjeder du ikke skal si høyt.
- **Uthevet tekst:** `**slik**` vises ekstra tydelig, fint til navn eller ord du vil trykke på.
- **Linjeskift:** teksten flyter på nytt så den fyller skjermen – enkle linjeskift midt i en
  setning blir altså ikke synlige. Vil du tvinge fram et skift, avslutt linja med to mellomrom,
  og bruk blank linje mellom avsnitt.
- Har dokumentet ingen overskrifter, tolkes hvert avsnitt som én introduksjon der
  første linje er navnet.

`eksempel-taler.txt` i dette repoet viser formatet, og knappen «Prøv med eksempeltekst»
laster det samme inn direkte.

## Kjøre lokalt

Ingen bygging og ingen avhengigheter – bare statiske filer:

```
python3 -m http.server 8000
```

Åpne så `http://localhost:8000`.

## Publisere

Repoet er klart for GitHub Pages: **Settings → Pages → Deploy from a branch**, velg
branchen og mappa `/ (root)`. Siden må serveres over HTTPS for at «legg til på
hjemskjerm» og offline-støtten skal virke.
