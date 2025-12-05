
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const NUM_PLAYERS = 4;
const TEAM_A_SEATS = [0, 2];
const TEAM_B_SEATS = [1, 3];

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

app.use(express.static('public'));

const rooms = {};

function createDeck() {
  const ranks = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const suits = ['♣', '♦', '♥', '♠'];
  const deck = [];
  let id = 0;
  for (const r of ranks) {
    for (const s of suits) {
      deck.push({ id: id++, rank: r, suit: s });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function createEmptyGame() {
  return {
    teams: {
      teamA: TEAM_A_SEATS.slice(),
      teamB: TEAM_B_SEATS.slice(),
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
    deckStarter: 0,
    startingPlayer: null,
    firstCardRank: null,
    leadOwner: null,
    someoneElseTookLead: false,
    playsInTrick: 0,
    specialExtensionAllowed: false,
    capturedA: [],
    capturedB: [],
    roundCardsA: 0,
    roundCardsB: 0,
    lastCollectorTeam: null,
    phase: 'lobby',
    winnerTeam: null
  };
}

function createRoom() {
  return {
    players: [null, null, null, null],
    game: createEmptyGame()
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
  game.roundCardsA = 0;
  game.roundCardsB = 0;
  game.lastCollectorTeam = null;
  game.phase = 'playing';

  if (typeof game.deckStarter !== 'number') {
    game.deckStarter = 0;
  }
  game.currentTurn = game.deckStarter;

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

  const filledSeats = room.players.filter(p => p !== null).length;
  if (filledSeats !== NUM_PLAYERS) return;

  if (game.winnerTeam !== null) {
    game.teams.scoreA = 0;
    game.teams.scoreB = 0;
    game.winnerTeam = null;
  }

  if (typeof game.deckStarter !== 'number') {
    game.deckStarter = 0;
  }

  dealNewRound(game);
}

function sameTeam(game, p1, p2) {
  const { teamA, teamB } = game.teams;
  return (teamA.includes(p1) && teamA.includes(p2)) ||
         (teamB.includes(p1) && teamB.includes(p2));
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

function handlePlayCard(room, playerIndex, cardId) {
  const game = room.game;
  if (!game || game.phase !== 'playing') return;

  const hand = game.hands[playerIndex];
  const cardIndex = hand.findIndex(c => c.id === cardId);
  if (cardIndex === -1) return;

  if (
    game.specialExtensionAllowed &&
    playerIndex === game.startingPlayer &&
    game.currentTurn === playerIndex
  ) {
    if (game.playsInTrick >= 16) return;

    const cand = hand[cardIndex];
    const canExtend = cand.rank === game.firstCardRank || cand.rank === '7';
    if (!canExtend) return;

    game.specialExtensionAllowed = false;
  } else {
    if (game.currentTurn !== playerIndex) return;
  }

  const [card] = hand.splice(cardIndex, 1);
  game.table.push({ playerIndex, card });

  if (game.table.length === 1) {
    game.startingPlayer = playerIndex;
    game.firstCardRank = card.rank;
    game.leadOwner = playerIndex;
    game.playsInTrick = 1;
    game.someoneElseTookLead = false;
  } else {
    game.playsInTrick++;

    if (card.rank === game.firstCardRank || card.rank === '7') {
      if (!sameTeam(game, playerIndex, game.startingPlayer)) {
        game.someoneElseTookLead = true;
      } else {
        game.someoneElseTookLead = false;
      }
      game.leadOwner = playerIndex;
    }
  }

  const nextPlayer = (playerIndex + 1) % NUM_PLAYERS;

  if (game.playsInTrick % 4 === 0) {
    game.currentTurn = game.startingPlayer;
    game.specialExtensionAllowed = true;
  } else {
    game.currentTurn = nextPlayer;
  }
}

function collectTrickAndMaybeScore(game, winnerIndex) {
  const teamA = game.teams.teamA;
  const toTeamA = teamA.includes(winnerIndex);
  const dest = toTeamA ? game.capturedA : game.capturedB;
  const collectorTeam = toTeamA ? 'A' : 'B';

  for (const entry of game.table) {
    dest.push(entry.card);
  }

  const collectedCount = game.table.length;
  if (toTeamA) {
    game.roundCardsA += collectedCount;
  } else {
    game.roundCardsB += collectedCount;
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
      if (c.rank === '10' || c.rank === 'A') ptsA += 10;
    }
    for (const c of game.capturedB) {
      if (c.rank === '10' || c.rank === 'A') ptsB += 10;
    }

    if (game.lastCollectorTeam === 'A') {
      ptsA += 10;
    } else if (game.lastCollectorTeam === 'B') {
      ptsB += 10;
    }

    if (ptsA === 90) ptsA += 10;
    if (ptsB === 90) ptsB += 10;

    game.teams.scoreA += ptsA;
    game.teams.scoreB += ptsB;

    const thisWinnerTeam = ptsA > ptsB ? 'A' : 'B';

    const ds = game.deckStarter;
    const teamAHasStarter = game.teams.teamA.includes(ds);
    const starterTeam = teamAHasStarter ? 'A' : 'B';
    if (starterTeam !== thisWinnerTeam) {
      game.deckStarter = (game.deckStarter + 1) % NUM_PLAYERS;
    }

    game.capturedA = [];
    game.capturedB = [];
    game.lastCollectorTeam = null;

    if (game.teams.scoreA >= 500 || game.teams.scoreB >= 500) {
      game.phase = 'finished';
      game.winnerTeam = game.teams.scoreA >= 500 ? 'A' : 'B';
      return;
    }

    dealNewRound(game);
    return;
  }

  game.currentTurn = winnerIndex;
}

function handlePickupDecision(room, playerIndex, choice) {
  const game = room.game;
  if (!game || game.phase !== 'playing') return;

  if (!game.specialExtensionAllowed) return;
  if (playerIndex !== game.startingPlayer) return;
  if (game.currentTurn !== playerIndex) return;

  let winnerIndex;

  if (choice === 'me') {
    if (game.leadOwner !== game.startingPlayer) return;
    winnerIndex = playerIndex;
  } else if (choice === 'opponent') {
    if (typeof game.leadOwner === 'number') {
      winnerIndex = game.leadOwner;
    } else {
      winnerIndex = playerIndex;
    }
  } else {
    return;
  }

  game.specialExtensionAllowed = false;
  collectTrickAndMaybeScore(game, winnerIndex);
}

function getPlayerIndexBySocket(room, socketId) {
  return room.players.findIndex(p => p && p.id === socketId);
}

function sanitizeGameForClient(room) {
  const game = room.game;
  const safe = JSON.parse(JSON.stringify(game));
  safe.players = room.players.map(p => (p ? { name: p.name } : null));
  return safe;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinRoom', ({ roomCode, playerName, preferredTeam }, callback) => {
    const code = (roomCode || 'ROOM').toUpperCase();
    if (!rooms[code]) {
      rooms[code] = createRoom();
    }
    const room = rooms[code];
    const game = room.game;

    let name = (playerName && playerName.trim()) || 'Igrač';

    let existingIndex = room.players.findIndex(
      p => p && p.name.toLowerCase() === name.toLowerCase()
    );
    if (existingIndex !== -1) {
      const player = room.players[existingIndex];
      player.id = socket.id;
      player.connected = true;
      socket.join(code);

      if (callback) {
        callback({
          success: true,
          roomCode: code,
          playerIndex: existingIndex,
          rejoined: true
        });
      }

      io.to(code).emit('roomUpdate', {
        players: room.players,
        scores: {
          teamA: game.teams.scoreA,
          teamB: game.teams.scoreB
        }
      });

      if (game.phase !== 'lobby') {
        io.to(socket.id).emit('gameState', sanitizeGameForClient(room));
      }
      return;
    }

    if (game.phase !== 'lobby') {
      return callback && callback({
        success: false,
        message: 'Igra je već u toku u ovoj sobi.'
      });
    }

    const teamPref = preferredTeam === 'B' ? 'B' : 'A';
    const candidates = teamPref === 'A' ? TEAM_A_SEATS : TEAM_B_SEATS;
    let seatIndex = candidates.find(i => room.players[i] === null);

    if (seatIndex === undefined) {
      return callback && callback({
        success: false,
        message: `Tim ${teamPref} je već popunjen.`
      });
    }

    const newPlayer = {
      id: socket.id,
      name: name,
      connected: true
    };
    room.players[seatIndex] = newPlayer;
    socket.join(code);

    if (callback) {
      callback({
        success: true,
        roomCode: code,
        playerIndex: seatIndex,
        rejoined: false
      });
    }

    io.to(code).emit('roomUpdate', {
      players: room.players,
      scores: {
        teamA: game.teams.scoreA,
        teamB: game.teams.scoreB
      }
    });

    const filledSeats = room.players.filter(p => p !== null).length;
    if (filledSeats === NUM_PLAYERS && game.phase === 'lobby') {
      startGame(room);
      io.to(code).emit('gameState', sanitizeGameForClient(room));
    }
  });

  socket.on('playCard', ({ roomCode, cardId }) => {
    const room = rooms[roomCode];
    if (!room || !room.game) return;

    const playerIndex = getPlayerIndexBySocket(room, socket.id);
    if (playerIndex === -1) return;

    handlePlayCard(room, playerIndex, cardId);
    io.to(roomCode).emit('gameState', sanitizeGameForClient(room));
  });

  socket.on('pickupDecision', ({ roomCode, choice }) => {
    const room = rooms[roomCode];
    if (!room || !room.game) return;

    const playerIndex = getPlayerIndexBySocket(room, socket.id);
    if (playerIndex === -1) return;

    handlePickupDecision(room, playerIndex, choice);
    io.to(roomCode).emit('gameState', sanitizeGameForClient(room));
  });

  socket.on('requestGameState', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || !room.game) return;
    io.to(socket.id).emit('gameState', sanitizeGameForClient(room));
  });

  socket.on('listRooms', (callback) => {
    const summary = Object.entries(rooms).map(([code, room]) => {
      return {
        code,
        players: room.players.map((p, idx) =>
          p ? { name: p.name, seat: idx, connected: !!p.connected } : null
        ),
        inProgress: room.game.phase !== 'lobby'
      };
    });
    if (callback) callback(summary);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const [code, room] of Object.entries(rooms)) {
      const idx = getPlayerIndexBySocket(room, socket.id);
      if (idx !== -1) {
        const player = room.players[idx];
        if (player) {
          player.connected = false;
          player.id = null;
        }

        io.to(code).emit('roomUpdate', {
          players: room.players,
          scores: {
            teamA: room.game.teams.scoreA,
            teamB: room.game.teams.scoreB
          }
        });
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
