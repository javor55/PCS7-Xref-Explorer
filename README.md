# PCS7 Xref Explorer

Offline nástroj (jeden HTML soubor, bez knihoven a bez internetu) pro procházení
**Chart Reference Data** ze SIMATIC PCS 7 a pro hledání **I/O rezerv** podle HW Configu.

👉 Stáhněte [`dist/PCS7_Xref_Explorer.html`](dist/PCS7_Xref_Explorer.html), otevřete v prohlížeči
(Edge / Chrome / Firefox) a přetáhněte do něj exporty. Data zůstávají jen v prohlížeči – nic se nikam neodesílá.

## Vstupy

| Export z PCS7 | K čemu |
|---|---|
| Block types | hierarchie, všechny bloky (i nenapojené), typy, FB/FC, komentáře |
| Block interconnections | propojení bloků → grafy CFC, okolí bloku, kontrola napojení |
| Cross-References Chart Element → Address | adresy I/Q/M/DB a symboly na pinech bloků |
| Cross-References SFC → Chart Element | co SFC čte/zapisuje v CFC |
| Accesses in SFC types | které I/O SFC typu se používají v krocích a tranzicích |
| Run sequence | OB, runtime skupina, pořadí |
| HW Config (Station → Export, `.cfg`) | stanice, RIO, karty a kanály → rezervy |

Export CSV: *CFC → Options → Chart Reference Data → File → Export…*  
Typ souboru se pozná podle hlavičky, název nehraje roli. Stačí nahrát jen některé – podle toho se zpřístupní funkce.

## Funkce

- **Strom hierarchie, typy bloků, SFC, OB** a fulltextové hledání (`t:` typ, `p:` pin, `a:` adresa)
- **Graf CFC** – bloky, interní spoje, vstupy/výstupy z jiných CFC, adresy a přístupy SFC; přehled složky s počty propojení mezi charty
- **Okolí bloku** – graf sousedů do zvolené hloubky, barvy podle CFC, export SVG
- **SFC kontrola** – které I/O SFC typu se používají a zda jsou zvenku napojené; u SFC chartů zda zapisované bloky vedou dál
- **Adresy** – filtr podle oblasti, vícenásobný zápis, vazba na HW kanál
- **HW / rezervy** – přehled kanálů po stanicích, hledač rezerv s návrhem kanálů a exportem CSV, kontroly HW ↔ CFC

## Vývoj

```bash
python3 build.py      # src/* → dist/PCS7_Xref_Explorer.html
```

`src/vendor/` obsahuje parser HW Configu a katalog karet z
[PCS7-IO-Analyzer](https://github.com/javor55/PCS7-IO-Analyzer) (MIT).

> ⚠️ Do repozitáře nikdy nedávejte reálné exporty (`.csv`, `.cfg`) ani screenshoty z projektu – `.gitignore` je blokuje.
