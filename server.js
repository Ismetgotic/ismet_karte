const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const NUM_PLAYERS = 4;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(express.static('public'));

const rooms = {}; // roomCode -> { players, game }

function createDeck() {
  const ranks = ["7", "8", "9", "10", "J", "Q", "K", "A"];
  const suits = ["♣", "♦", "♥", "♠"];
  const deck = [];
  let id = 0;
  for (const r of ranks) {
    for (const s of suits) {
      deck.push({ id: id++, rank: r, suit: s });
    }
  }
  // shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function createEmptyGame() {
  return {
    players: [], // {id, name}
    teams: {
      teamA: [0, 2],
      teamB: [1, 3],
      scoreA: 0,
      scoreB: 0
    },
    deck: [],
    hands: {
      0: [],
      1: [],
      2: [],
      3: []
    },
    table: [],
    currentTurn: 0,
    deckStarter: 0,        // KO OTVARA CIJELI ŠPIL (servis)
    startingPlayer: null,  // ko je otvorio konkretni mini-krug
    firstCardRank: null,
    leadOwner: null,       // zadnji koji je odigrao istu cifru ili 7 (trenutno vodstvo)
    someoneElseTookLead: false, // suparnička ekipa trenutno drži vodstvo u odnosu na startera
    playsInTrick: 0,
    specialExtensionAllowed: false,
    capturedA: [],
    capturedB: [],
    lastCollectorTeam: null, // "A" ili "B"
    phase: "lobby",
    winnerTeam: null
  };
}

function dealNewRound(game) {
  game.deck = createDeck();
  game.hands = { 0: [], 1: [], 2: [], 3: [] };
  game.table = [];
  game.startingPlayer = null;
  game.firstCardRank = null;
  game.leadOwner = null;
  game.someoneElseTookLead = false;
  game.playsInTrick = 0;
  game.specialExtensionAllowed = false;
  game.capturedA = [];
  game.capturedB = [];
  game.lastCollectorTeam = null;
  game.phase = "playing";

  if (typeof game.deckStarter !== "number") {
    game.deckStarter = 0;
  }
  game.currentTurn = game.deckStarter;

  // početno dijeljenje – svi ravnomjerno do max 4
  let needMore = true;
  while (needMore && game.deck.length > 0) {
    needMore = false;
    for (let p = 0; p < NUM_PLAYERS; p++) {
      if (game.hands[p].length < 4 && game.deck.length > 0) {
        game.hands[p].push(game.deck.pop());
        needMore = true;
      }
    }
  }
}

function startGame(room) {
  if (!room.game) {
    room.game = createEmptyGame();
  }
  const game = room.game;
  if (game.players.length !== NUM_PLAYERS) return;

  if (game.winnerTeam !== null) {
    game.teams.scoreA = 0;
    game.teams.scoreB = 0;
    game.winnerTeam = null;
  }
  game.deckStarter = 0;
  dealNewRound(game);
}

function sameTeam(game, p1, p2) {
  const { teamA, teamB } = game.teams;
  return (teamA.includes(p1) && teamA.includes(p2)) ||
         (teamB.includes(p1) && teamB.includes(p2));
}

function handlePlayCard(room, playerIndex, cardId) {
  const game = room.game;
  if (!game || game.phase !== "playing") return;

  const hand = game.hands[playerIndex];
  const cardIndex = hand.findIndex(c => c.id === cardId);
  if (cardIndex === -1) return;

  // specijalna faza – starter odlučuje hoće li produžiti
  if (game.specialExtensionAllowed &&
      playerIndex === game.startingPlayer &&
      game.currentTurn === playerIndex) {

    if (game.playsInTrick >= 16) {
      return;
    }

    const cand = hand[cardIndex];
    const canExtend = (cand.rank === game.firstCardRank || cand.rank === "7");
    if (!canExtend) {
      return;
    }
    game.specialExtensionAllowed = false;
  } else {
    if (game.currentTurn !== playerIndex) {
      return;
    }
  }

  const [card] = hand.splice(cardIndex, 1);
  game.table.push({ playerIndex, card });

  if (game.table.length === 1) {
    // prva karta u ovoj mini-rundi
    game.startingPlayer = playerIndex;
    game.firstCardRank = card.rank;
    game.leadOwner = playerIndex;       // za sada starter drži vodstvo
    game.playsInTrick = 1;
    game.someoneElseTookLead = false;
  } else {
    game.playsInTrick++;

    // provjera preuzimanja vodstva
    if (card.rank === game.firstCardRank || card.rank === "7") {
      if (!sameTeam(game, playerIndex, game.startingPlayer)) {
        // protivnička ekipa je sada na čelu
        game.someoneElseTookLead = true;
      } else {
        // starterova ekipa je ponovo na čelu (starter ili saigrač)
        game.someoneElseTookLead = false;
      }
      game.leadOwner = playerIndex;
    }
  }

  const nextPlayer = (playerIndex + 1) % NUM_PLAYERS;

  // nakon svakog punog kruga (4,8,12,16) starter dobija pravo odluke
  if (game.playsInTrick % 4 === 0) {
    game.currentTurn = game.startingPlayer;
    game.specialExtensionAllowed = true;
  } else {
    game.currentTurn = nextPlayer;
  }
}

function topUpHandsEqually(game) {
  let needMore = true;
  while (needMore && game.deck.length > 0) {
    needMore = false;
    for (let p = 0; p < NUM_PLAYERS; p++) {
      if (game.hands[p].length < 4 && game.deck.length > 0) {
        game.hands[p].push(game.deck.pop());
        needMore = true;
      }
    }
  }
}

function collectTrickAndMaybeScore(game, winnerIndex) {
  const teamA = game.teams.teamA;
  const toTeamA = teamA.includes(winnerIndex);
  const dest = toTeamA ? game.capturedA : game.capturedB;
  const collectorTeam = toTeamA ? "A" : "B";

  for (const entry of game.table) {
    dest.push(entry.card);
  }
  game.table = [];
  game.lastCollectorTeam = collectorTeam;

  topUpHandsEqually(game);

  game.startingPlayer = null;
  game.firstCardRank = null;
  game.leadOwner = null;
  game.someoneElseTookLead = false;
  game.playsInTrick = 0;
  game.specialExtensionAllowed = false;

  const allEmpty =
    game.deck.length === 0 &&
    game.hands[0].length === 0 &&
    game.hands[1].length === 0 &&
    game.hands[2].length === 0 &&
    game.hands[3].length === 0;

  if (allEmpty) {
    let ptsA = 0;
    let ptsB = 0;
    for (const c of game.capturedA) {
      if (c.rank === "10" || c.rank === "A") ptsA += 10;
    }
    for (const c of game.capturedB) {
      if (c.rank === "10" || c.rank === "A") ptsB += 10;
    }

    // bonus za zadnji sto – nema izjednačenja
    if (game.lastCollectorTeam === "A") {
      ptsA += 10;
    } else if (game.lastCollectorTeam === "B") {
      ptsB += 10;
    }

    // BONUS: ako ekipa uzme svih 9 poena (4 A, 4 10 + zadnji sto) = 90, dobija još +10
    if (ptsA === 90) {
      ptsA += 10;
    }
    if (ptsB === 90) {
      ptsB += 10;
    }

    game.teams.scoreA += ptsA;
    game.teams.scoreB += ptsB;

    const thisWinnerTeam = ptsA > ptsB ? "A" : "B";

    // servis (deckStarter): ako je ekipa servisera izgubila, servis ide udesno
    const ds = game.deckStarter;
    const teamAHasStarter = game.teams.teamA.includes(ds);
    const starterTeam = teamAHasStarter ? "A" : "B";
    if (starterTeam !== thisWinnerTeam) {
      game.deckStarter = (game.deckStarter + 1) % NUM_PLAYERS;
    }

    game.capturedA = [];
    game.capturedB = [];
    game.lastCollectorTeam = null;

    if (game.teams.scoreA >= 500 || game.teams.scoreB >= 500) {
      game.phase = "finished";
      game.winnerTeam = game.teams.scoreA >= 500 ? "A" : "B";
      return;
    }

    dealNewRound(game);
    return;
  }

  // novi mini-krug uvijek otvara onaj ko je nosio sto
  game.currentTurn = winnerIndex;
}

function handlePickupDecision(room, playerIndex, choice) {
  const game = room.game;
  if (!game || game.phase !== "playing") return;

  if (!game.specialExtensionAllowed) return;
  if (playerIndex !== game.startingPlayer) return;
  if (game.currentTurn !== playerIndex) return;

  let winnerIndex;

  if (choice === "me") {
    // "Kupim" je dozvoljen SAMO ako starter još uvijek drži vodstvo,
    // tj. zadnja matching/7 karta je od startera (leadOwner === startingPlayer)
    if (game.leadOwner !== game.startingPlayer) {
      return;
    }
    winnerIndex = playerIndex;
  } else if (choice === "opponent") {
    // Tipka "Nosi" – nosi ONAJ ko trenutno drži vodstvo (leadOwner),
    // bez obzira da li je to protivnik ili saigrač.
    if (typeof game.leadOwner === "number") {
      winnerIndex = game.leadOwner;
    } else {
      // ako iz nekog razloga leadOwner nije postavljen, default na startera
      winnerIndex = playerIndex;
    }
  } else {
    return;
  }

  game.specialExtensionAllowed = false;
  collectTrickAndMaybeScore(game, winnerIndex);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinRoom', ({ roomCode, playerName }, callback) => {
    const code = (roomCode || 'ROOM').toUpperCase();
    if (!rooms[code]) {
      rooms[code] = { players: [], game: createEmptyGame() };
    }
    const room = rooms[code];

    if (room.players.length >= NUM_PLAYERS) {
      return callback && callback({ success: false, message: 'Soba je puna (max 4 igrača).' });
    }

    if (!playerName || !playerName.trim()) {
      playerName = 'Igrač ' + (room.players.length + 1);
    }

    room.players.push({ id: socket.id, name: playerName.trim() });
    room.game.players = room.players;

    socket.join(code);

    if (callback) {
      callback({ success: true, roomCode: code, playerIndex: room.players.length - 1 });
    }

    io.to(code).emit('roomUpdate', {
      players: room.players,
      scores: {
        teamA: room.game.teams.scoreA,
        teamB: room.game.teams.scoreB
      }
    });

    if (room.players.length === NUM_PLAYERS && room.game.phase === "lobby") {
      startGame(room);
      io.to(code).emit('gameState', sanitizeGameForClient(room.game, code));
    }
  });

  socket.on('playCard', ({ roomCode, cardId }) => {
    const room = rooms[roomCode];
    if (!room || !room.game) return;

    const game = room.game;
    const playerIndex = game.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) return;

    handlePlayCard(room, playerIndex, cardId);

    io.to(roomCode).emit('gameState', sanitizeGameForClient(room.game, roomCode));
  });

  socket.on('pickupDecision', ({ roomCode, choice }) => {
    const room = rooms[roomCode];
    if (!room || !room.game) return;
    const game = room.game;
    const playerIndex = game.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) return;

    handlePickupDecision(room, playerIndex, choice);
    io.to(roomCode).emit('gameState', sanitizeGameForClient(room.game, roomCode));
  });

  socket.on('requestGameState', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || !room.game) return;
    io.to(socket.id).emit('gameState', sanitizeGameForClient(room.game, roomCode));
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const [code, room] of Object.entries(rooms)) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        room.game.players = room.players;
        io.to(code).emit('roomUpdate', {
          players: room.players,
          scores: {
            teamA: room.game.teams.scoreA,
            teamB: room.game.teams.scoreB
          }
        });
        if (room.players.length === 0) {
          delete rooms[code];
        }
        break;
      }
    }
  });
});

function sanitizeGameForClient(game, roomCode) {
  const safe = JSON.parse(JSON.stringify(game));
  return safe;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});