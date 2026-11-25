# Stipendi e pagamenti (versione cellulare)

App web installabile sul telefono (PWA) per tenere traccia di acconti, saldi e buste paga, mese per mese.

## Dove stanno i dati

**Solo sul telefono.** Mesi, importi e PDF delle buste paga vengono salvati nell'archivio interno dell'app (IndexedDB) sul dispositivo dove la usi. Non vanno su internet, né su GitHub, né su altri server. Questo repository contiene solo il codice: nessun dato personale.

Conseguenze pratiche:

- Ogni dispositivo ha i suoi dati: quello che inserisci sul telefono non compare sul computer.
- Se elimini l'app dalla schermata Home (o cancelli i dati del sito nel browser), i dati spariscono. Per questo esiste **Menu ☰ › Crea backup**: un file `.json` con tutti i mesi e tutti i PDF, da conservare per esempio su Dropbox. Con **Ripristina da backup** lo ricarichi su un telefono nuovo.
- L'app funziona anche offline.

## Cosa fa

- Elenco dei 12 mesi dell'anno con acconto e data, saldo e data, totale ricevuto, cedolino (netto in busta) e differenza.
- In alto: quanto resta da ricevere, quanto spetta, quanto è arrivato, quanti mesi sono da saldare.
- **Carica busta paga**: legge il PDF, riconosce mese e netto, e conserva il PDF nell'app collegato a quel mese. Se il netto non viene trovato, si inserisce a mano. In *Impostazioni* puoi scrivere il tuo nome come appare in busta paga per aiutare la lettura (resta sul telefono).
- **Registra pagamento**: va in acconto se il mese non ne ha uno, altrimenti si somma al saldo.
- Tocca un mese per modificarlo, allegare o sostituire il PDF, o eliminarlo.
- Dal **Menu ☰**: esporta in Excel, crea backup, ripristina, importa da Excel (es. `tracciamento_pagamenti.xlsx`, colonne MESE, ACCONTO, DATA ACCONTO, SALDO, DATA SALDO, CEDOLINO, BUSTA PAGA), carica più buste paga insieme.

## Installarla sul telefono

1. Apri l'indirizzo GitHub Pages dell'app.
2. **iPhone (Safari)**: tasto Condividi › *Aggiungi alla schermata Home*.
   **Android (Chrome)**: menu ⋮ › *Installa app* (o *Aggiungi a schermata Home*).
3. Apri l'app dall'icona e, la prima volta, importa il tuo Excel o un backup dal Menu ☰.

Su iPhone l'app installata ha un archivio separato da Safari: importa i dati **dopo** averla aperta dall'icona.

## Sviluppo

Sito statico, nessuna compilazione. Per provarla in locale: `python3 -m http.server` nella cartella e apri `http://localhost:8000`.

Librerie incluse in `vendor/`: [pdf.js](https://github.com/mozilla/pdf.js) 3.11.174 (Apache 2.0) e [SheetJS](https://sheetjs.com) 0.18.5 (Apache 2.0).

Quando modifichi i file, aumenta il numero di `CACHE` in `sw.js` così i telefoni scaricano la nuova versione.
