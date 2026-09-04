# Toastmaster

En liten nettside som viser toastmaster-manuset vårt, én post om gangen, i stor og
lettlest skrift på mobil. Laget for å leses fra hånda mens man står foran forsamlingen.

Manuset er delt i poster – én per taler som skal introduseres – og hver post består av
replikker merket med hvem som sier dem. Du velger hvem du er, og dine replikker vises
store og uthevet (Anders i rosa, Fredrik i grønt), mens den andres står som dempede
stikkord slik at du ser når det er din tur.

## Hvor teksten kommer fra

Siden henter manuset fra Google-dokumentet og oppdaterer seg selv hvert tiende sekund
mens den er åpen. Google Docs sender ingen CORS-headere, så nettleseren kan ikke hente
dokumentet direkte; i stedet proxyer Netlify det:

```
/manus  ->  https://docs.google.com/document/d/<dokument-id>/export?format=txt   (status 200)
```

Regelen ligger i `netlify.toml`. Skal siden peke på et annet dokument, er det bare
å bytte ID-en der.

Teksten mellomlagres i nettleseren, så siden virker også uten nett – da vises sist
hentede manus, og statuslinjen sier fra at den ikke får kontakt. Et dokument som
svarer med tull eller for få poster får ikke overskrive et manus som virker.

I menyen kan synkingen slås av. Redigerer eller laster du opp tekst manuelt, slås
den av automatisk, slik at dokumentet ikke overskriver det du nettopp la inn.

## Slik bruker du den

1. Åpne siden på mobilen (legg den gjerne til på hjemskjermen).
2. Velg hvem du er – **Anders** eller **Fredrik**.
3. Trykk på posten du skal lese. Teksten fyller skjermen.
4. Sveip sidelengs, eller bruk **Forrige / Neste**, for å bla. **A− / A+** justerer
   tekststørrelsen, og den huskes til neste gang.

Skjermen holdes våken mens du står i lesevisningen (der nettleseren støtter det).

## Format på manuset

Parseren er laget for å tåle vanlig tekst rett fra Google Docs:

- **Dag/bolk:** en kort linje i STORE BOKSTAVER, for eksempel `FREDAG` eller
  `LØRDAG (Hovedfesten)`.
- **Post:** en kort linje som står for seg selv, uten punktum til slutt –
  `1. Miriam (Karos venninne)`, `Karo (Bruden)`, `Henning - Forlover`. Nummeret
  fjernes, og linjen regnes bare som overskrift hvis det følger replikker under den.
- **Replikk:** `Anders: ...` eller `Fredrik: ...`. Et navn foran kolon teller som
  replikkmerke først når det går igjen i manuset, slik at en enkeltlinje som
  `Musikkforslag:` forblir vanlig tekst.
- **Regibeskjed:** en linje helt i `(parentes)` eller `[hakeparentes]`, for eksempel
  `(Spill video)`. Den vises i uthevingsfargen og er tydelig ikke noe du skal si høyt.
- **Uthevet tekst:** `**slik**`.
- Dokumentets tittel øverst hoppes over, og replikker før den første posten samles
  under en post som heter «Velkomst».

Manuset kan også skrives med markdown-overskrifter (`# FREDAG`, `## Navn`) – det er
formatet `manus.txt` bruker.

## Filene

| Fil | Rolle |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | selve siden – ingen bygging, ingen avhengigheter |
| `manus.txt` | manuset som ligger innebygd i siden, og brukes hvis dokumentet ikke svarer |
| `netlify.toml` | proxy til Google-dokumentet, og noindex-header |
| `sw.js`, `manifest.json`, `icon.svg` | offline-støtte og hjemskjerm-ikon |
| `build.mjs` | legger `manus.txt` inn i `index.html` og bygger `dist/toastmaster.html` |
| `dist/toastmaster.html` | hele appen i én fil, brukt til den delbare Claude-lenken (uten synk) |

Etter endringer i `manus.txt`: kjør `node build.mjs`.

## Kjøre lokalt

```
python3 -m http.server 8000
```

`/manus` finnes ikke lokalt, så siden viser det innebygde manuset og sier fra at den
ikke får kontakt med dokumentet. Vil du teste synkingen, legg en fil som heter `manus`
(uten filendelse) i mappa.
