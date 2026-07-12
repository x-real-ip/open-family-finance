# Open Family Finance

*Read this in other languages: [English](README.md)*

Open Family Finance is een zelf-gehoste webapp voor stellen en gezinnen die
allebei een eigen rekening hebben, plus één gezamenlijke rekening voor
gedeelde kosten. De app geeft inzicht in wat er binnenkomt en uitgaat, en
berekent een eerlijke maandelijkse overboeking van elke persoonlijke rekening
naar de gezamenlijke rekening.

## Het idee

- Elke partner vult zijn/haar eigen **netto inkomen** in.
- Je houdt **gezamenlijke uitgaven** bij (huur, boodschappen, verzekeringen,
  ...), **spaardoelen**, en eventuele **overheidsbijdragen** (bijv.
  kinderbijslag) die verlagen wat jullie zelf moeten inleggen.
- De app berekent `uitgaven + sparen − overheidsbijdrage` = wat jullie samen
  moeten financieren, en verdeelt dat bedrag tussen de partners op een van
  drie manieren:
  - **Naar inkomen** — wie meer verdient, legt naar verhouding meer in, zodat
    na de overboeking beide partners hetzelfde *percentage* van hun eigen
    salaris overhouden.
  - **50 / 50** — verdeel het gezamenlijke bedrag gelijk, ongeacht inkomen.
  - **Eigen verdeling** — stel zelf een vast percentage in (bijv. 60/40) als
    geen van bovenstaande bij jullie situatie past.
- Er wordt een kleine, instelbare **buffer-marge** (%) bovenop elke
  overboeking gezet, zodat de gezamenlijke rekening een buffer overhoudt in
  plaats van precies op nul uit te komen.

Alles wordt **per maand** ingevuld en bekeken, zodat je kunt volgen hoe de
cijfers zich over tijd ontwikkelen.

## Functies

- **Eerlijke-verdeling-calculator** — naar inkomen, 50/50, of je eigen
  percentage, met een instelbare veiligheidsmarge, en een uitklapbare uitleg
  van precies hoe elk bedrag is berekend.
- **Maandelijkse bijhouding met doorwerking naar volgende maanden** — een
  wijziging aan een post geldt voor de huidige maand én elke volgende maand,
  totdat die post in een van die maanden zelf weer wordt aangepast (dan wordt
  hij daar "vastgezet"). Eerdere maanden worden nooit automatisch aangepast.
- **Inkomsten, overheidsbijdrage, uitgaven en sparen**, elk als losse
  regels met een categorie (bij uitgaven), een optionele notitie en een
  optionele link (bijv. naar een factuur of contract).
- **Gekoppelde/formule-posten** — leid het bedrag van de ene post af van een
  andere (bijv. "bruto salaris min pensioenpremie"), met een reeks
  bewerkingen (plus / min / keer / gedeeld door).
- **Trendindicatoren & verloop-sparkline** per post, die de huidige maand
  vergelijkt met de meest recente eerdere maand met een ingevuld bedrag.
- **Kopieer-functies** — kopieer het bedrag van één post naar andere maanden,
  of kopieer de cijfers van een hele maand naar eerdere maanden.
- **Logboek** — elke wijziging wordt vastgelegd met datum, tijd, oude en
  nieuwe waarde.
- **Statistieken** — staafdiagram van de inleg per partner per maand, een
  staafdiagram van inkomsten / overheidsbijdrage / uitgaven / sparen per
  maand, en een cirkeldiagram van uitgaven per categorie. Alle grafieken
  kunnen worden beperkt tot een zelfgekozen periode (standaard alle maanden).
- **Sorteren** — sorteer uitgaven, overheidsbijdragen en spaardoelen op naam
  (uitgaven ook op categorie), of versleep ze naar je eigen handmatige
  volgorde.
- **Looptijd van contracten** — geef een post een start- en einddatum om een
  contract of abonnement te volgen, met een voortgangsbalk en een
  kleurgecodeerde waarschuwing zodra het binnenkort afloopt (binnen 30 dagen)
  of al verlopen is.
- **Licht en donker thema.**
- **Nederlandse en Engelse UI**, instelbaar via een environment-variabele.
- **Optionele paperless-ngx-integratie** — kies een correspondent uit je
  paperless-omgeving bij uitgaven, overheidsbijdrage en spaardoelen, of typ
  gewoon je eigen waarde, en spring meteen naar het meest recente document dat
  paperless daarvoor heeft. Zie [Paperless-ngx-integratie](#paperless-ngx-integratie).
- **Zelf te hosten**: een kleine Express-API met Postgres als opslag, met een
  optioneel bearer-token om toegang af te schermen.

## Aan de slag

De snelste manier om de hele stack (database + API + frontend) lokaal te
draaien is met Docker Compose:

```sh
cp .env.example .env
# pas .env aan als je de databasegegevens wilt wijzigen, of stel
# API_TOKEN / LANGUAGE / APP_TITLE in — zie "Configuratie" hieronder
docker compose up --build
```

De app is daarna beschikbaar op <http://localhost:8080>.

### Lokaal ontwikkelen (zonder Docker)

```sh
# backend
cd backend && npm install && npm run dev   # http://localhost:8080

# frontend, in een aparte terminal
cd frontend && npm install && npm run dev  # http://localhost:5173, proxyt /api naar de backend
```

## Configuratie

Alle configuratie loopt via environment-variabelen — zie
[`.env.example`](.env.example) voor de volledige lijst die Docker Compose
gebruikt:

| Variabele             | Standaard                | Omschrijving |
|------------------------|----------------------------|--------------|
| `POSTGRES_USER`         | —                          | Postgres-gebruikersnaam |
| `POSTGRES_PASSWORD`     | —                          | Postgres-wachtwoord |
| `POSTGRES_DB`           | —                          | Postgres-databasenaam |
| `API_TOKEN`             | *(leeg = API is open)*    | Optioneel bearer-token dat vereist is bij elk `/api`-verzoek, gedeeld tussen frontend en backend |
| `LANGUAGE`              | `nl`                       | UI-taal: `nl` of `en` |
| `APP_TITLE`             | `Open Family Finance`      | Paginatitel/kop die in de app wordt getoond |
| `PAPERLESS_ENABLED`     | `false`                    | Zet de paperless-ngx-correspondentintegratie aan, zowel de backend-proxy als de frontend-UI (zie hieronder) |
| `PAPERLESS_URL`         | —                          | Basis-URL die de **backend** gebruikt om de paperless-API aan te roepen. Alleen backend, alleen gebruikt als `PAPERLESS_ENABLED=true` |
| `PAPERLESS_PUBLIC_URL`  | *(valt terug op `PAPERLESS_URL`)* | Basis-URL waarmee "open in paperless"-links worden opgebouwd. Alleen nodig als paperless voor je browser op een ander adres bereikbaar is dan `PAPERLESS_URL` (bijv. als `PAPERLESS_URL` een cluster-interne URL is) |
| `PAPERLESS_API_TOKEN`   | —                          | paperless-ngx API-token. Alleen backend, komt nooit in de browser terecht |
| `PAPERLESS_DOCUMENT_TYPE_PRIORITY` | —              | Optionele, kommagescheiden lijst van documenttype-namen in prioriteitsvolgorde (bijv. `Jaaropgave,Jaarafrekening,Factuur,Contract`). Het gekoppelde document wordt het meest recente document van het eerste type uit deze lijst dat de correspondent heeft, in plaats van gewoon het meest recente document. Alleen backend |

`LANGUAGE`, `APP_TITLE` en `PAPERLESS_ENABLED` worden door de frontend bij het
opstarten van de container ingelezen (niet vast gebakken in de build), zodat
dezelfde image voor verschillende omgevingen hergebruikt kan worden.

## Paperless-ngx-integratie

Als je [paperless-ngx](https://docs.paperless-ngx.com/) draait en je
correspondenten (de bedrijven/afzenders op je documenten) beschikbaar wilt
hebben bij het invullen van uitgaven, overheidsbijdrage of sparen:

1. Genereer een API-token in paperless-ngx (gebruikersprofiel → API-token).
2. Zet `PAPERLESS_ENABLED=true`, `PAPERLESS_URL` en `PAPERLESS_API_TOKEN`
   (en `PAPERLESS_PUBLIC_URL`, als paperless voor je browser op een ander
   adres bereikbaar is) voor de **backend**, en `PAPERLESS_ENABLED=true` voor
   de **frontend** — zie [Configuratie](#configuratie).
3. Bij uitgaven, overheidsbijdrage en spaardoelen verschijnt een
   correspondent-icoon in de actierij — standaard ingeklapt, zodat entries die
   het niet nodig hebben niet vollopen. Erop klikken opent een veld dat namen
   uit paperless suggereert terwijl je typt, maar accepteert ook nog gewoon
   alles wat je zelf intypt. Een naam die nog niet in paperless bestaat wordt
   daar automatisch ook aangemaakt, zodat ze in sync blijven.
4. Komt de getypte naam overeen met een bekende correspondent in paperless,
   dan toont datzelfde popovertje meteen het meest recente document dat
   paperless daarvoor heeft (als er een is), met een link om 'm direct in
   paperless te openen. Zet `PAPERLESS_DOCUMENT_TYPE_PRIORITY` om bepaalde
   documenttypes (bijv. een jaaropgave of factuur) voorrang te geven boven
   gewoon het meest recente document.

De frontend praat nooit rechtstreeks met paperless en krijgt `PAPERLESS_URL`,
`PAPERLESS_PUBLIC_URL` of `PAPERLESS_API_TOKEN` nooit te zien — alle
communicatie loopt via de backend-API. Laat je `PAPERLESS_ENABLED` leeg (of
op `false`), dan is het
correspondent-veld nergens te zien en wordt er niets opgehaald.

## Data & privacy

Alle cijfers worden als één JSON-blob opgeslagen in je eigen Postgres-database
via de meegeleverde API — er gaat niets naar derden. Echte bedragen staan
nooit in deze repository, waardoor die publiek kan zijn.

## Projectstatus

Dit project is in actieve ontwikkeling en **nog niet productierijp**:
functies kunnen onvolledig zijn, breaking changes kunnen zonder aankondiging
gebeuren, en er kunnen af en toe bugs voorkomen. Bijdragen, bugmeldingen en
feedback zijn welkom.

## Licentie

Apache License 2.0 — zie [`LICENSE`](LICENSE).
