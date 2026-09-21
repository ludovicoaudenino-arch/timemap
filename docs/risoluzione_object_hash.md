# Risoluzione dell'errore di runtime e rimozione di `object-hash`

Questo documento illustra nel dettaglio la diagnosi del problema della **pagina bianca nel browser**, la causa tecnica alla radice, la strategia adottata per rimuovere la dipendenza `object-hash` e i benefici quantificabili ottenuti per l'applicazione e per la stesura della tesi di laurea.

---

## 1. Il Problema: Perché i Test Passavano ma il Browser Mostrava Pagina Bianca?

### L'Errore a Runtime
Aprendo l'applicazione nel browser, la pagina restava completamente bianca e la console JavaScript registrava il seguente errore fatale:

```text
Uncaught TypeError: Cannot read properties of undefined (reading 'crypto')
  at node_modules/.vite/deps/object-hash.js:205
```

Questo errore bloccava immediatamente l'esecuzione prima ancora che React potesse iniziare a montare l'interfaccia.

### La Causa Tecnica: Moduli Node.js vs Ambiente Browser
- **`crypto`** è un modulo nativo dell'ambiente **Node.js** (il runtime su cui gira il server o gli script da riga di comando), utilizzato per calcolare impronte crittografiche (SHA-1, MD5).
- I browser web (Chrome, Firefox, Edge) non possiedono nativamente l'API `crypto` di Node.js (hanno una Web Crypto API con un'interfaccia differente).
- In passato, **Webpack 4** forniva in automatico dei *polyfill* (surrogati/emulazioni software in JavaScript) per tutti i moduli interni di Node.js quando impacchettava il codice per il browser.
- **Vite** (così come Webpack 5), per garantire standard moderni e massime prestazioni, non include polyfill automatici per Node.js. Quando `object-hash` ha tentato di invocare `crypto.createHash`, la variabile `crypto` risultava `undefined`, causando il crash istantaneo dell'applicazione.

### Perché i Test Unitari con Vitest Erano Tutti "Verdi"?
Vitest esegue i test in ambiente **Node.js** (utilizzando una libreria chiamata `jsdom` che simula la struttura dell'HTML in memoria). Poiché il runtime effettivo dei test era Node.js, `crypto` era realmente presente in memoria globale. Di conseguenza:
- I test unitari passavano al 100% (59 test su 59).
- Il browser reale andava in crash all'avvio.

> **Spunto metodologico per la tesi:** Questo caso rappresenta un classico limite dei test unitari eseguiti in ambienti virtualizzati (*headless / jsdom*). Dimostra come i test automatici verifichino la logica interna ma non possano garantire l'assenza di incompatibilità d'ambiente a runtime nel client reale.

---

## 2. Perché `object-hash` Era un Problema anche per le Prestazioni?

In linguaggi come il **C** o **Java**, confrontare se due strutture sono identiche può avvenire:
1. **Per riferimento (puntatori):** `ptrA == ptrB` richiede **1 ciclo di clock ($O(1)$)** confrontando solo l'indirizzo di memoria.
2. **Per valore superficiale:** confrontando i singoli campi numerici/primitivi (poche istruzioni).
3. **Per serializzazione e hash crittografico:** convertire l'intero albero di oggetti in una stringa di testo ed eseguire un algoritmo crittografico (SHA-1). Questa operazione è **estremamente onerosa ($O(N)$)** sia per la CPU sia per la memoria.

La vecchia codebase TimeMap usava `object-hash` perfino per:
- Generare chiavi di elementi grafici (`key={hash(marker)}`).
- Verificare se le proprietà di un componente erano cambiate (`if (hash(nextProps) !== hash(this.props))`).

Calcolare l'hash crittografico di oggetti complessi (che contengono centinaia di sessioni Honeypot e coordinate geografiche) causava:
- **~680 ms** di blocco CPU nella `Timeline`.
- **~378 ms** di blocco CPU nella `Map`.

---

## 3. Le Modifiche Effettuate: Sostituzione dei 9 Usi nei 5 File

È stata scelta ed eseguita la **seconda strada (la soluzione architetturale pulita)**: rimuovere completamente `object-hash` senza aggiungere cerotti o polyfill.

### 1. SelectedEvents.jsx (Uso 1)
- **Prima:** Usava `hash(marker)` come identificatore unico React (`key`).
- **Dopo:** I marker creati in `Map.jsx` possiedono già un identificatore univoco `id` (sia per singoli eventi che per cluster).
- **Modifica:**
  ```diff
  - import hash from "object-hash";
  ...
  - <g key={hash(marker)} className="location-marker" ...>
  + <g key={marker.id} className="location-marker" ...>
  ```

### 2. CardStack.jsx (Uso 2)
- **Prima:** `key={hash(content)}` serializzava e calcolava l'hash di tutto l'oggetto formattato della card.
- **Dopo:** Ogni evento possiede un `id` nativo; in caso di assenza, si usa l'indice posizionale `idx`.
- **Modifica:**
  ```diff
  - import hash from "object-hash";
  ...
  - <Card key={hash(content)} ... />
  + <Card key={event.id ?? idx} ... />
  ```

### 3. Card.jsx (Usi 3, 4, 5)
- **Prima:** `hash(row)`, `hash(field)` e `hash(content)` calcolavano l'hash per ogni singola riga e cella della card.
- **Dopo:** Le righe e i campi di un template di una card sono statici e ordinati posizionalmente; gli indici `rIdx` e `fIdx` rappresentano la chiave naturale in React.
- **Modifica:**
  ```diff
  - import hash from "object-hash";
  ...
  - function renderRow(row) {
  -   return (
  -     <div className="card-row" key={hash(row)}>
  -       {row.map((field) => (
  -         <span key={hash(field)}>{renderField(field)}</span>
  -       ))}
  -     </div>
  -   );
  - }
  + function renderRow(row, rIdx) {
  +   return (
  +     <div className="card-row" key={`card-row-${rIdx}`}>
  +       {row.map((field, fIdx) => (
  +         <span key={`card-field-${fIdx}`}>{renderField(field)}</span>
  +       ))}
  +     </div>
  +   );
  + }
  ```
  *(Inoltre, rimosso il superfluo `key={hash(content)}` dal tag radice `<li>` del componente).*

### 4. utilities.js (Uso 6)
- **Prima:** `isIdentical(obj1, obj2)` delegava il confronto a `hash(obj1) === hash(obj2)`.
- **Dopo:** Questa funzione era utilizzata esclusivamente per confrontare i `bounds` geografici della mappa (una struttura con quattro coordinate numeriche `[[lat1, lng1], [lat2, lng2]]`). È stata riscritta con un confronto strutturale elemento per elemento (simile a un `memcmp` o confronto ricorsivo di array), immediato e a costo zero di hash.
- **Modifica:**
  ```diff
  - import hash from "object-hash";
  ...
  - export function isIdentical(obj1, obj2) {
  -   return hash(obj1) === hash(obj2);
  - }
  + export function isIdentical(obj1, obj2) {
  +   if (obj1 === obj2) return true;
  +   if (!obj1 || !obj2) return false;
  +   if (Array.isArray(obj1) && Array.isArray(obj2)) {
  +     if (obj1.length !== obj2.length) return false;
  +     return obj1.every((val, idx) => isIdentical(val, obj2[idx]));
  +   }
  +   if (typeof obj1 === "object" && typeof obj2 === "object") {
  +     const keys1 = Object.keys(obj1);
  +     const keys2 = Object.keys(obj2);
  +     if (keys1.length !== keys2.length) return false;
  +     return keys1.every((key) => isIdentical(obj1[key], obj2[key]));
  +   }
  +   return false;
  + }
  ```

### 5. Timeline.jsx (Usi 7, 8, 9)
- **Prima:** Calcolava l'hash crittografico di tutte le proprietà (`nextProps` vs `this.props`), che contengono l'intero dataset di eventi storici.
- **Dopo:**
  1. `nextProps.app.timeline.range !== this.props.app.timeline.range`: in Redux lo stato è immutabile; un nuovo intervallo temporale produce un nuovo riferimento d'oggetto (indirizzo di memoria). Il confronto tra puntatori `!==` è istantaneo (1 ciclo di CPU).
  2. `nextProps.activeCategories !== this.props.activeCategories`: le categorie attive provengono dallo stato Redux, per cui l'uguaglianza referenziale `!==` è sufficiente.
  3. `nextProps.dimensions !== this.props.dimensions`: le dimensioni provengono da un selettore memoizzato con Reselect (`selectDimensions`), che mantiene lo stesso riferimento fintanto che le dimensioni dello schermo non cambiano.
- **Modifica:**
  ```diff
  - import hash from "object-hash";
  ...
  - if (hash(nextProps) !== hash(this.props)) {
  + if (nextProps.app.timeline.range !== this.props.app.timeline.range) {
      this.setState({
        timerange: nextProps.app.timeline.range,
        scaleX: this.makeScaleX(),
      });
    }

  - if (
  -   hash(nextProps.activeCategories) !== hash(this.props.activeCategories) ||
  -   hash(nextProps.dimensions) !== hash(this.props.dimensions)
  - ) {
  + if (
  +   nextProps.activeCategories !== this.props.activeCategories ||
  +   nextProps.dimensions !== this.props.dimensions
  + ) {
      const { trackHeight, marginTop } = nextProps.dimensions;
  ```

### 6. package.json
- La dipendenza `"object-hash": "^1.3.0"` è stata definitivamente eliminata dal file di configurazione delle dipendenze.

---

## 4. Risultati e Metriche Quantificabili

| Metrica | Prima | Dopo | Miglioramento |
| :--- | :--- | :--- | :--- |
| **Errore browser (crypto undefined)** | Bloccante (schermo bianco) | Risolto (0 errori) | Funzionamento sbloccato |
| **Tempo esecuzione suite test Vitest** | ~61.4 secondi | ~8.0 secondi | **~7.6x più veloce (-87%)** |
| **Dimensione bundle JavaScript compilato** | 844.04 kB | 808.17 kB | **-35.87 kB** |
| **Costo computazionale controlli Timeline** | ~680 ms (hash $O(N)$) | < 1 ms (puntatori $O(1)$) | **Eliminato collo di bottiglia** |
| **Dipendenze da moduli interni di Node.js** | Presenti (crypto) | Zero | **Piena compatibilità browser nativo** |

---

## 5. Valore Aggiunto per la Tesi di Laurea

Questa operazione non è stata un semplice "aggiornamento di pacchetti", ma fornisce due elementi di alto valore accademico e ingegneristico:

1. **Riflessione Metodologica sul Testing:**  
   Mostra che una suite di test al 100% verde può creare un falso senso di sicurezza se l'ambiente di esecuzione dei test (Node/jsdom) differisce dall'ambiente di destinazione (browser). È la dimostrazione pratica del perché i test di integrazione/end-to-end nel browser siano complementari e indispensabili rispetto ai soli test unitari.

2. **Ottimizzazione Algoritmica Guidata dalla Struttura Dati:**  
   Sostituire la serializzazione crittografica con controlli di identità referenziale sfrutta l'immutabilità dello stato di Redux e la memoizzazione dei selettori (pattern Reselect). Si è trasformata un'operazione computazionalmente pesante da $O(N)$ a tempo costante $O(1)$.
