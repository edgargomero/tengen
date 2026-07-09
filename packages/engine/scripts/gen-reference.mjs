#!/usr/bin/env node
// Genera los fixtures de referencia `kata-raw-nn` (JSON committeados en
// tests/fixtures/reference/) contra los que Task 10 testea el encoding V7 +
// evaluador ONNX de principio a fin. Herramienta local de test (no código de
// producto): corre KataGo desktop 1.16.5 vía GTP, no copia código de KataGo.
//
// Formato de la respuesta GTP a `kata-raw-nn 0` y el framing (doble newline
// por respuesta) están documentados y verificados en
// .superpowers/sdd/task-0-brief.md — ver ese archivo para el porqué de este
// parseo. Determinismo: numSearchThreads=1 + símbolo 0 (identidad, sin
// búsqueda) → misma entrada, misma salida, bit a bit.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = resolve(__dirname, '..', 'models', 'katago-bin', 'b18c384nbt.bin.gz');
const GTP_CONFIG =
  process.env.KATAGO_GTP_CONFIG ?? '/opt/homebrew/share/katago/configs/gtp_example.cfg';
const OUT_DIR = resolve(__dirname, '..', 'tests', 'fixtures', 'reference');

/**
 * @typedef {{
 *   name: string,
 *   boardSize: number,
 *   komi: number,
 *   rules: 'chinese' | 'japanese',
 *   moves: Array<[player: 'b' | 'w', vertex: string]>,
 *   nextPlayer: 'b' | 'w',
 * }} Case
 */

/** @type {Case[]} */
const CASES = [
  { name: 'empty-19', boardSize: 19, komi: 7.5, rules: 'chinese', moves: [], nextPlayer: 'b' },
  { name: 'empty-13', boardSize: 13, komi: 6.5, rules: 'japanese', moves: [], nextPlayer: 'b' },
  { name: 'empty-9', boardSize: 9, komi: 7.5, rules: 'chinese', moves: [], nextPlayer: 'b' },

  // Aperturas estándar: hoshi (4-4) y komoku (3-4), un solo movimiento negro.
  {
    name: 'opening-44',
    boardSize: 19,
    komi: 7.5,
    rules: 'chinese',
    moves: [['b', 'Q16']],
    nextPlayer: 'w',
  },
  {
    name: 'opening-34',
    boardSize: 19,
    komi: 6.5,
    rules: 'japanese',
    moves: [['b', 'C4']],
    nextPlayer: 'w',
  },

  // Escalera: negro G3 queda con 1 sola libertad (H3) tras el atari en cruz
  // de blanco (F3/G2/G4). ladder-fails añade una piedra negra de rescate
  // (H6) en la diagonal de huida, sin la cual la persecución llega al borde.
  // Verificado legal contra katago real (ver task-0-report.md); la
  // corrección táctica exacta de "funciona/falla" no es el gate de este
  // task — kata-raw-nn es el oráculo, no un análisis de escaleras propio.
  {
    name: 'ladder-works',
    boardSize: 9,
    komi: 7.5,
    rules: 'chinese',
    moves: [
      ['b', 'G3'],
      ['w', 'F3'],
      ['w', 'G2'],
      ['w', 'G4'],
    ],
    nextPlayer: 'b',
  },
  {
    name: 'ladder-fails',
    boardSize: 9,
    komi: 7.5,
    rules: 'chinese',
    moves: [
      ['b', 'G3'],
      ['w', 'F3'],
      ['w', 'G2'],
      ['w', 'G4'],
      ['b', 'H6'],
    ],
    nextPlayer: 'w',
  },

  // Seki simple: isla negra {A1,A2} y forro blanco {A3,B3,C3,C2,C1} verificados
  // a mano con EXACTAMENTE las mismas 2 libertades compartidas (B1,B2) y
  // ninguna libertad externa para ninguno de los dos — la definición de seki.
  // El muro negro exterior (D1-D4,A4-C4) solo sella el bolsillo (vivo aparte,
  // no conectado a la isla). Nota: `final_status_list seki` de katago NO lo
  // reconoce como seki (lo marca "dead" para blanco) — es una posición fuera
  // de distribución para su estimador de status entrenado en partidas
  // reales; no afecta a este fixture, que solo captura kata-raw-nn crudo.
  {
    name: 'seki',
    boardSize: 9,
    komi: 7.5,
    rules: 'chinese',
    moves: [
      ['b', 'D1'],
      ['b', 'D2'],
      ['b', 'D3'],
      ['b', 'D4'],
      ['b', 'A4'],
      ['b', 'B4'],
      ['b', 'C4'],
      ['w', 'A3'],
      ['w', 'B3'],
      ['w', 'C3'],
      ['w', 'C2'],
      ['w', 'C1'],
      ['b', 'A1'],
      ['b', 'A2'],
    ],
    nextPlayer: 'w',
  },

  // Ko simple: blanco captura la piedra negra suelta en B2 jugando C2 (ambas
  // piedras quedan con 1 sola libertad en el punto recién vaciado/ocupado).
  // Verificado con katago: la captura ocurre tal cual (B stones captured: 1).
  // Hallazgo verificado (ver task-0-report.md): el GTP `play` de katago NO
  // rechaza la recaptura inmediata en B2 (responde "=", no "?"), pero el
  // `policy` de kata-raw-nn SÍ marca B2 como NaN/ilegal (índice 64 en el
  // fixture, confirmado calculando la orientación real de la grilla) — o
  // sea, `board.ko_loc` está correctamente activo a nivel de encoding/NN
  // aunque la capa de legalidad de `play` en GTP no lo esté aplicando. El
  // fixture sí ejercita el plano 6 (ko prohibido).
  {
    name: 'ko',
    boardSize: 9,
    komi: 7.5,
    rules: 'chinese',
    moves: [
      ['w', 'A2'],
      ['w', 'B1'],
      ['w', 'B3'],
      ['b', 'B2'],
      ['b', 'D2'],
      ['b', 'C1'],
      ['b', 'C3'],
      ['w', 'C2'],
    ],
    nextPlayer: 'b',
  },

  // Endgame casi cerrado: muros D (negro) / E (blanco) prácticamente
  // completos, con exactamente 2 puntos neutros abiertos (D5,E5). Columnas
  // A-C y F-J quedan como territorio vacío de cada lado (no hace falta
  // rellenarlas para que la posición sea válida).
  {
    name: 'endgame',
    boardSize: 9,
    komi: 6.5,
    rules: 'japanese',
    moves: [
      ['b', 'D1'],
      ['w', 'E1'],
      ['b', 'D2'],
      ['w', 'E2'],
      ['b', 'D3'],
      ['w', 'E3'],
      ['b', 'D4'],
      ['w', 'E4'],
      ['b', 'D6'],
      ['w', 'E6'],
      ['b', 'D7'],
      ['w', 'E7'],
      ['b', 'D8'],
      ['w', 'E8'],
      ['b', 'D9'],
      ['w', 'E9'],
    ],
    nextPlayer: 'b',
  },
];

function spawnKatago() {
  const proc = spawn('katago', [
    'gtp',
    '-config',
    GTP_CONFIG,
    '-model',
    MODEL_PATH,
    '-override-config',
    'numSearchThreads=1,logToStderr=false',
  ]);
  // El log de arranque de katago (versión, backend Metal, modelo cargado)
  // va a stderr; se descarta salvo que el proceso muera (ver 'error'/'exit').
  proc.stderr.on('data', () => {});
  return proc;
}

/**
 * Driver GTP mínimo: manda comandos por stdin a un proceso katago ya vivo y
 * resuelve una promesa por cada uno cuando llega el doble-newline (línea en
 * blanco) que cierra su respuesta — así se reutiliza un solo proceso katago
 * para toda la batería de casos (evita recargar el modelo ~15-30s cada vez).
 * @param {import('node:child_process').ChildProcessWithoutNullStreams} proc
 */
function makeGtpDriver(proc) {
  let buf = '';
  /** @type {Array<(resp: string) => void>} */
  const pending = [];
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8').replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const resp = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const settle = pending.shift();
      if (settle) settle(resp);
    }
  });
  /** @param {string} cmd */
  return function send(cmd) {
    return new Promise((res) => {
      pending.push(res);
      proc.stdin.write(cmd + '\n');
    });
  };
}

/**
 * Parsea la respuesta cruda de `kata-raw-nn 0`, tolerante al orden de las
 * claves escalares. Formato (ver task-0-brief.md, capturado contra katago
 * real): primera línea "= symmetry N"; luego pares "clave valor" en
 * cualquier orden; los bloques `policy`/`whiteOwnership` son una línea de
 * cabecera (un solo token) seguida de `boardSize` filas de `boardSize`
 * floats en row-major (índice = fila_impresa·N + columna). 'NAN' en policy
 * marca una jugada ilegal — Number('NAN') ya da NaN, sin caso especial.
 * @param {string} resp
 * @param {number} boardSize
 */
function parseRawNn(resp, boardSize) {
  const lines = resp.replace(/^=\s*/, '').split('\n');
  const scalarKeys = [
    'whiteWin',
    'whiteLoss',
    'noResult',
    'whiteLead',
    'whiteScoreSelfplay',
    'whiteScoreSelfplaySq',
    'varTimeLeft',
    'shorttermWinlossError',
    'shorttermScoreError',
    'policyPass',
  ];
  const out = {
    whiteWin: NaN,
    whiteLoss: NaN,
    noResult: NaN,
    whiteLead: NaN,
    whiteScoreSelfplay: NaN,
    whiteScoreSelfplaySq: NaN,
    varTimeLeft: NaN,
    shorttermWinlossError: NaN,
    shorttermScoreError: NaN,
    policyPass: NaN,
    /** @type {number[]} */
    policy: [],
    /** @type {number[]} */
    whiteOwnership: [],
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    const tokens = line.split(/\s+/);
    if (tokens.length === 1) {
      const key = tokens[0];
      if (key !== 'policy' && key !== 'whiteOwnership') {
        throw new Error(`Cabecera de grilla desconocida: "${key}"`);
      }
      const grid = /** @type {number[]} */ ([]);
      for (let r = 0; r < boardSize; r++) {
        i++;
        if (i >= lines.length) {
          throw new Error(`${key}: se acabaron las líneas esperando ${boardSize} filas`);
        }
        const row = lines[i].trim().split(/\s+/).map(Number);
        if (row.length !== boardSize) {
          throw new Error(
            `${key}: fila con ${row.length} valores, esperaba ${boardSize} ("${lines[i]}")`,
          );
        }
        grid.push(...row);
      }
      out[key] = grid;
    } else if (tokens.length === 2 && scalarKeys.includes(tokens[0])) {
      out[tokens[0]] = Number(tokens[1]);
    } else if (tokens[0] === 'symmetry') {
      continue; // ya lo pedimos fijo en 0; no hace falta guardarlo.
    } else {
      throw new Error(`Línea inesperada en respuesta kata-raw-nn: "${line}"`);
    }
  }
  const area = boardSize * boardSize;
  if (out.policy.length !== area) {
    throw new Error(`policy incompleta: ${out.policy.length} valores, esperaba ${area}`);
  }
  if (out.whiteOwnership.length !== area) {
    throw new Error(`whiteOwnership incompleta: ${out.whiteOwnership.length} valores, esperaba ${area}`);
  }
  return out;
}

/**
 * @param {(cmd: string) => Promise<string>} send
 * @param {Case} c
 */
async function runCase(send, c) {
  const check = (/** @type {string} */ resp, /** @type {string} */ cmd) => {
    if (!resp.startsWith('=')) {
      throw new Error(`katago rechazó "${cmd}" en el caso "${c.name}": ${resp}`);
    }
    return resp;
  };
  check(await send('clear_board'), 'clear_board');
  check(await send(`boardsize ${c.boardSize}`), `boardsize ${c.boardSize}`);
  check(await send(`komi ${c.komi}`), `komi ${c.komi}`);
  check(await send(`kata-set-rules ${c.rules}`), `kata-set-rules ${c.rules}`);
  for (const [player, vertex] of c.moves) {
    check(await send(`play ${player} ${vertex}`), `play ${player} ${vertex}`);
  }
  const rawResp = check(await send('kata-raw-nn 0'), 'kata-raw-nn 0');
  const parsed = parseRawNn(rawResp, c.boardSize);
  return {
    boardSize: c.boardSize,
    komi: c.komi,
    rules: c.rules,
    moves: c.moves,
    nextPlayer: c.nextPlayer,
    ...parsed,
  };
}

// Ancla de sanity medida a mano (ver task-0-brief.md): 19x19 vacío komi 7.5,
// reglas chinas → el argmax de policy cae en los 4 hoshi (índices 60/72/288/300,
// casi empatados ≈0.14-0.15) y whiteWin≈0.628. Si esto no reproduce, hay un
// bug en el driver/parser — cortar antes de commitear cualquier fixture.
function checkEmpty19Sanity(fixture) {
  const HOSHI = [60, 72, 288, 300];
  const indexed = fixture.policy.map((v, i) => [i, v]);
  indexed.sort((a, b) => b[1] - a[1]);
  const top4 = indexed
    .slice(0, 4)
    .map(([i]) => i)
    .sort((a, b) => a - b);
  const hoshiOk = JSON.stringify(top4) === JSON.stringify(HOSHI);
  const winOk = Math.abs(fixture.whiteWin - 0.628) < 0.02;
  if (!hoshiOk || !winOk) {
    throw new Error(
      `Sanity de empty-19 FALLÓ: top4=${JSON.stringify(top4)} (esperaba ${JSON.stringify(HOSHI)}), ` +
        `whiteWin=${fixture.whiteWin} (esperaba ≈0.628)`,
    );
  }
  console.log(`  sanity ok: top4=${JSON.stringify(top4)} whiteWin=${fixture.whiteWin.toFixed(6)}`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const proc = spawnKatago();
  const send = makeGtpDriver(proc);
  proc.on('error', (err) => {
    console.error('No se pudo lanzar katago:', err);
    process.exit(1);
  });

  let exitCode = 0;
  try {
    /** @type {Record<string, unknown>} */
    const generated = {};
    for (const c of CASES) {
      process.stdout.write(`Generando ${c.name}... `);
      const fixture = await runCase(send, c);
      generated[c.name] = fixture;
      writeFileSync(resolve(OUT_DIR, `${c.name}.json`), JSON.stringify(fixture, null, 2) + '\n');
      console.log('ok');
    }

    console.log('Verificando ancla de sanity (empty-19)...');
    checkEmpty19Sanity(generated['empty-19']);

    console.log('Verificando determinismo (empty-19 repetido)...');
    const rerun = await runCase(
      send,
      CASES.find((c) => c.name === 'empty-19'),
    );
    if (JSON.stringify(rerun) !== JSON.stringify(generated['empty-19'])) {
      throw new Error('empty-19 no es determinista entre corridas (misma entrada, salida distinta)');
    }
    console.log('  determinismo ok: misma salida bit a bit en la segunda corrida.');

    console.log(`\n${CASES.length} fixtures escritos en ${OUT_DIR}`);
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    proc.kill();
  }
  process.exit(exitCode);
}

main();
