const express = require("express");
const http = require("http");
const cors = require("cors");
const {v4: uuidv4} = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const suits = ["Clubs", "Spades", "Diamonds", "Hearts"];
const ranks = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"];
const values = Object.fromEntries(ranks.map((r) => [r, parseInt(r)]));

const MAX_PLAYERS = 2;
const rooms = {};

function createRoom() {
  const roomId = uuidv4();
  rooms[roomId] = {
    players: [],
    deck: [],
    centerCard: null,
    currentTurnIndex: 0,
    reactionMode: false,
    reactionValue: null,
    reactingPlayers: [],
    queensTriggered: false,
    queensPlayerIndex: null,
    finalRoundActive: false,
    finalTurnCount: 0,
    initialSelectionMode: true,
    gameStarted: false,
    lastActivity: Date.now()
  };
  createDeck(roomId);
  return roomId;
}

function shuffleDeck(deck){
  for (let i = deck.length -1; i > 0; i--){
    const j = Math.floor(Math.random() * (i+1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

function createDeck(roomId) {
  const room = rooms[roomId];
  room.deck = [];
  for (let suit of suits){
    for (let rank of ranks){
      room.deck.push({ suit, rank, value: values[rank], card_id: `${suit}_${rank}_${Date.now()}`, is_face_up: false });
    }
  }
  shuffleDeck(room.deck);
}

function resetGame(roomId) {
  const room = rooms[roomId];
  room.players = [];
  createDeck(roomId);
  room.centerCard = null;
  room.currentTurnIndex = 0;
  room.reactionMode = false;
  room.reactionValue = null;
  room.reactingPlayers = [];
  room.queensTriggered = false;
  room.queensPlayerIndex = null;
  room.finalRoundActive = false;
  room.finalTurnCount = 0;
}

function drawHand(roomId) {
  const room = rooms[roomId];
  const hand = [];
  for (let i = 0; i < 4; i++) {
    if (room.deck.length > 0) {
      hand.push(room.deck.pop());
    }
  }
  return hand;
}

function getCenterCard(roomId) {
  const room = rooms[roomId];
  if (!room.centerCard && room.deck.length > 0) {
    room.centerCard = room.deck.pop();
  }
  return room.centerCard;
}

function nextTurn(roomId) {
  const room = rooms[roomId];
  if (room.finalRoundActive) {
    room.finalTurnCount++;
    if (room.finalTurnCount >= room.players.length) {
      return calculateWinner(roomId);
    }
  }
  room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
  return { game_over: false };
}

function calculateWinner(roomId) {
  const room = rooms[roomId];
  let lowestValue = Infinity;
  let winnerIndex = -1;

  room.players.forEach((player, index) => {
    player.hand.forEach(card => {
      if (card.value < lowestValue) {
        lowestValue = card.value;
        winnerIndex = index;
      }
    });
  });

  return {
    game_over: true,
    winner_index: winnerIndex,
    message: `Game Over! Player ${winnerIndex} wins!`
  };
}

app.post("/create_room", (req, res) => {
  try {
    const roomId = createRoom();
    rooms[roomId].lastActivity = Date.now();
    res.json({
      status: "ok",
      room_id: roomId
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post("/join", (req, res) => {
  try {
    const { room_id, player_id } = req.body;
    
    if (!rooms[room_id]) {
      return res.status(404).json({
        status: 'error',
        message: 'Room not found'
      });
    }

    const room = rooms[room_id];
    const isRoomCreator = room.players.length === 0;
    
    if (player_id) {
      const existing = room.players.find(p => p.id === player_id);
      if (existing) {
        const rejoinData = {
          status: "ok",
          room_id: room_id,
          player_id: existing.id,
          player_index: existing.index,
          hand: existing.hand,
          center_card: getCenterCard(room_id),
          current_turn_index: room.currentTurnIndex,
          total_players: room.players.length,
          initial_selection_mode: room.initialSelectionMode
        };
        return res.json(rejoinData);
      }
    }

    if (room.players.length >= MAX_PLAYERS) {
      return res.status(400).json({
        status: 'error',
        message: 'Game is full'
      });
    }

    const playerID = player_id || uuidv4(); 
    const newHand = drawHand(room_id);
    const newPlayer = {
      id: playerID,
      hand: newHand,
      index: isRoomCreator ? 0 : room.players.length,
      lastSeen: Date.now(),
      score: 0,
      initialSelectionComplete: false
    };

    room.players.push(newPlayer);
    room.lastActivity = Date.now();

    if (room.players.length === MAX_PLAYERS) {
      room.initialSelectionMode = true;
      room.currentTurnIndex = -1;
      room.lastActivity = Date.now();
    }

    res.json({
      status: 'ok',
      room_id: room_id,
      player_id: playerID,
      player_index: newPlayer.index,
      hand: newPlayer.hand,
      center_card: null,
      current_turn_index: room.currentTurnIndex,
      total_players: room.players.length,
      initial_selection_mode: room.initialSelectionMode,
      room_full: room.players.length === MAX_PLAYERS
    });

  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post("/play_card", (req, res) => {
  try {
    const { room_id, player_index, card } = req.body;
    
    if (!rooms[room_id]) {
      return res.status(404).json({
        status: 'error',
        message: 'Room not found'
      });
    }

    const room = rooms[room_id];
    const player = room.players[player_index];

    if (player_index !== room.currentTurnIndex && !room.reactionMode) {
      return res.status(403).json({
        status: "error",
        message: `not ur turn. Current turn: ${room.currentTurnIndex}, ur index: ${player_index}`
      });
    }

    if (!player) {
      return res.status(404).json({
        status: "error",
        message: "Player not found"
      });
    }

    const cardIndex = player.hand.findIndex(c => c.card_id === card.card_id);
    if (cardIndex === -1) {
      return res.status(400).json({ status: "error", message: "Card not in hand" });
    }

    if (room.reactionMode && card.value !== room.reactionValue) {
      if (!room.reactingPlayers.includes(player_index)) {
        room.reactingPlayers.push(player_index);
        if (room.deck.length > 0) {
            const penaltyCard = room.deck.pop();
            player.hand.push(penaltyCard);
        }
        return res.json({
          status: "ok",
          hand: player.hand,
          message: "Invalid card, penalty card added",
          center_card: room.centerCard,
          current_turn_index: room.currentTurnIndex,
          total_players: room.players.length
        });
      }
    }

    const playedCardData = { ...card };

    player.hand.splice(cardIndex, 1);
    
    room.centerCard = null;
    room.lastActivity = Date.now();

    let response = { 
      status: "ok", 
      center_card: room.centerCard,
      current_turn_index: room.currentTurnIndex,
      total_players: room.players.length,
    };

    if (playedCardData.rank === "13") {
      response.center_card = playedCardData;
      response.king_reveal_mode = true;
      response.king_player_index = player_index;
      response.message = "King played! Choose one of your cards to reveal.";
    } else if (playedCardData.rank === "11") {
      response.center_card = playedCardData;
      response.jack_swap_mode = true;
      response.jack_player_index = player_index;
      response.message = "Jack played! Select a card to swap.";
      response.hand = player.hand;
      return res.json(response);
    } else if (playedCardData.rank === "12") {
      const nextPlayerIndex = (player_index + 1) % room.players.length;
      const nextPlayer = room.players[nextPlayerIndex];
      nextPlayer.hand.push(playedCardData);
      response.center_card = null;
      response.message = "Queen played! It goes to the next player's hand.";
    } else {
        response.center_card = playedCardData;
        room.reactionMode = true;
        room.reactionValue = playedCardData.value;
        room.reactingPlayers = [];
        response.reaction_mode = true;
        response.reaction_value = playedCardData.value;
        response.message = `Reaction mode active! Play a ${playedCardData.value}.`;
    }
    
    const turnResult = nextTurn(room_id);
    response.current_turn_index = room.currentTurnIndex;
    if (turnResult.game_over) {
        response = { ...response, ...turnResult };
    }

    response.hand = player.hand;

    res.json(response);

  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post("/select_initial_cards", (req, res) => {
  try {
    const { room_id, player_index, selected_card_ids } = req.body;

    if (!rooms[room_id]) {
      return res.status(404).json({ status: 'error', message: 'Room not found' });
    }

    const room = rooms[room_id];
    const player = room.players[player_index];

    if (!room.initialSelectionMode) {
      return res.status(400).json({ status: 'error', message: 'Not in initial selection mode.' });
    }

    if (player.initialSelectionComplete) {
      return res.status(400).json({ status: 'error', message: 'Initial selection already complete.' });
    }

    if (!selected_card_ids || selected_card_ids.length !== 2) {
      return res.status(400).json({ status: 'error', message: 'Must select exactly 2 cards.' });
    }

    const validCards = selected_card_ids.every(card_id => 
      player.hand.some(card => card.card_id === card_id)
    );

    if (!validCards) {
      return res.status(400).json({ status: 'error', message: 'Invalid cards selected.' });
    }

    player.selectedCardIds = selected_card_ids;
    player.initialSelectionComplete = true;

    const allSelected = room.players.every(p => p.initialSelectionComplete);

    if (allSelected) {
      room.initialSelectionMode = false;
      room.gameStarted = true;
      room.currentTurnIndex = 0;

      const centerCard = getCenterCard(room_id);
      if (centerCard) {
        centerCard.is_face_up = true;
      }
      room.centerCard = centerCard;

      let turnCard = null;
      if (room.deck.length > 0) {
        turnCard = room.deck.pop();
        if (player_index === 0) {
          room.players[0].hand.push(turnCard);
        }
      }

      res.json({ 
        status: 'ok', 
        message: 'Initial selection complete. Game starting.',
        game_started: true,
        all_players_ready: true,
        initial_selection_mode: false,
        current_turn_index: room.currentTurnIndex,
        center_card: room.centerCard,
        first_turn_card: player_index === 0 ? turnCard : null
      });
    } else {
      res.json({ 
        status: 'ok', 
        message: 'Selection received. Waiting for other players.',
        game_started: false,
        all_players_ready: false,
        initial_selection_mode: true
      });
    }

  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get("/state", (req, res) => {
  try {
    const { room_id, player_id } = req.query;
    
    if (!rooms[room_id]) {
      return res.status(404).json({
        status: 'error',
        message: 'Room not found'
      });
    }

    const room = rooms[room_id];
    
    const players = room.players.map(p => {
      const playerData = {
        index: p.index,
        hand_size: p.hand ? p.hand.length : 0,
        initialSelectionComplete: p.initialSelectionComplete || false
      };

      if (!p.hand || !Array.isArray(p.hand)) {
        p.hand = [];
      }

      const isRequestingPlayer = player_id && p.id === player_id;

      if (isRequestingPlayer) {
        playerData.hand = p.hand.map(card => ({
          ...card,
          card_id: card.card_id || `missing_${Date.now()}`,
          suit: card.suit || "Unknown",
          rank: card.rank || "Unknown",
          value: card.value || 0,
          is_face_up: card.is_face_up || false
        }));
      } else {
        playerData.hand = p.hand.map(card => ({
          card_id: card.card_id || `hidden_${Date.now()}`,
          is_face_up: false
        }));
      }

      return playerData;
    });

    const stateData = {
      center_card: room.centerCard,
      current_turn_index: room.currentTurnIndex,
      deck_count: room.deck.length,
      total_players: room.players.length,
      players: players,
      reaction_mode: room.reactionMode,
      reaction_value: room.reactionValue,
      queens_triggered: room.queensTriggered,
      final_round_active: room.finalRoundActive,
      initial_selection_mode: room.initialSelectionMode,
      game_started: room.gameStarted || false
    };

    res.json(stateData);

  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: error.message
    });
  }
});

app.post("/reset", (req, res) => {
  const { room_id } = req.body;
  
  if (!rooms[room_id]) {
    return res.status(404).json({
      status: 'error',
      message: 'Room not found'
    });
  }

  resetGame(room_id);
  res.json({
    status: 'ok',
    message: 'Game reset complete'
  });
});

app.get("/rooms", (req, res) => {
  try {
    const activeRooms = Object.entries(rooms).map(([id, room]) => ({
      id,
      players: room.players.length,
      max_players: MAX_PLAYERS,
      is_full: room.players.length >= MAX_PLAYERS
    }));
    
    res.json({
      status: "ok",
      rooms: activeRooms
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post("/draw_card", (req, res) => {
  try {
    const { room_id, player_index } = req.body;
    
    if (!rooms[room_id]) {
      return res.status(404).json({
        status: 'error',
        message: 'Room not found'
      });
    }

    const room = rooms[room_id];
    const player = room.players[player_index];

    if (!player) {
      return res.status(404).json({
        status: 'error',
        message: 'Player not found'
      });
    }

    if (!room.gameStarted || room.initialSelectionMode) {
      return res.status(403).json({
        status: 'error',
        message: 'Game has not started yet'
      });
    }

    if (player_index !== room.currentTurnIndex) {
      return res.status(403).json({
        status: 'error',
        message: 'Not your turn'
      });
    }

    if (room.deck.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No cards left in deck'
      });
    }

    const drawnCard = room.deck.pop();
    player.hand.push(drawnCard);

    res.json({
      status: 'ok',
      card: drawnCard,
      message: 'Card drawn successfully'
    });

  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

function checkInactiveRooms() {
  const now = Date.now();
  const inactivityTimeout = 2 * 60 * 1000;
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (now - room.lastActivity > inactivityTimeout) {
      delete rooms[roomId];
    }
  }
}

setInterval(checkInactiveRooms, 30 * 1000);

const port = process.env.PORT || 3000;
app.listen(port, () => {}); 