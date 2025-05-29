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
    finalTurnCount: 0
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
      room.deck.push({ suit, rank, value: values[rank], card_id: `${suit}_${rank}_${Date.now()}`});
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
  console.log("game state reset for room:", roomId);
}

function drawHand(roomId) {
  return rooms[roomId].deck.splice(0, 4);
}

function getCenterCard(roomId) {
  const room = rooms[roomId];
  if (!room.centerCard && room.deck.length > 0) {
    room.centerCard = room.deck.pop();
    console.log("Center card set to:", room.centerCard);
  }
  return room.centerCard;
}

function nextTurn(roomId) {
  const room = rooms[roomId];
  if (room.finalRoundActive) {
    room.finalTurnCount++;
    if (room.finalTurnCount >= room.players.length) {
      const result = calculateFinalScore(roomId);
      return { game_over: true, ...result };
    }
  }
  room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
  console.log(`Turn changed to player ${room.currentTurnIndex} in room ${roomId}`);
  return { game_over: false };
}

function calculateFinalScore(roomId) {
  const room = rooms[roomId];
  let scores = [];
  let totalOtherScores = 0;
  let lowestScore = Infinity;
  let queensScore = 0;

  room.players.forEach((player, i) => {
    let handScore = 0;
    player.hand.forEach(card => {
      if (card.rank === "12") handScore += 0;
      else if (card.rank === "1") handScore += 1;
      else if (["11", "13"].includes(card.rank)) handScore += 10;
      else handScore += parseInt(card.rank);
    });
    scores.push(handScore);
    if (i === room.queensPlayerIndex) queensScore = handScore;
    else totalOtherScores += handScore;
    if (handScore < lowestScore) lowestScore = handScore;
  });

  if (queensScore === lowestScore) {
    return { winner: room.queensPlayerIndex, message: `player ${room.queensPlayerIndex + 1} wins!` };
  } else {
    room.players[room.queensPlayerIndex].score = totalOtherScores;
    room.players.forEach((p, i) => { if (i !== room.queensPlayerIndex) p.score = 0; });
    return { winner: null, message: `player ${room.queensPlayerIndex + 1} called queens but didn't have the lowest score. They get ${totalOtherScores} points.` };
  }
}

// New endpoint to create a room
app.post("/create_room", (req, res) => {
  try {
    const roomId = createRoom();
    res.json({
      status: "ok",
      room_id: roomId
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Modified join endpoint to include room_id
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
    
    if (player_id) {
      const existing = room.players.find(p => p.id === player_id);
      if (existing) {
        return res.json({
          status: "ok",
          room_id: room_id,
          player_id: existing.id,
          player_index: existing.index,
          hand: existing.hand,
          center_card: getCenterCard(room_id),
          current_turn_index: room.currentTurnIndex,
          total_players: room.players.length
        });
      }
    }

    if (room.players.length >= MAX_PLAYERS) {
      return res.status(400).json({
        status: 'error',
        message: 'Game is full'
      });
    }

    const playerID = uuidv4(); 
    const newPlayer = {
      id: playerID,
      hand: drawHand(room_id), 
      index: room.players.length,
      lastSeen: Date.now(),
      score: 0 
    };

    room.players.push(newPlayer);
    console.log(`player ${newPlayer.index} joined room ${room_id}, total players: ${room.players.length}`);

    res.json({
      status: 'ok',
      room_id: room_id,
      player_id: playerID,
      player_index: newPlayer.index,
      hand: newPlayer.hand,
      center_card: getCenterCard(room_id),
      current_turn_index: room.currentTurnIndex,
      total_players: room.players.length
    });

  } catch (error) {
    console.error('Error in join:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Modified play_card endpoint
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

    if (player_index !== room.currentTurnIndex && !room.reactionMode) {
      return res.status(403).json({
        status: "error",
        message: `not ur turn. Current turn: ${room.currentTurnIndex}, ur index: ${player_index}`
      });
    }

    const player = room.players.find(p => p.index === player_index);

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
        player.hand.push(room.deck.pop());
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

    player.hand.splice(cardIndex, 1); 
    room.centerCard = card;
    const turnResult = nextTurn(room_id); 
    let response = { 
      status: "ok", 
      center_card: room.centerCard, 
      current_turn_index: room.currentTurnIndex, 
      total_players: room.players.length, 
      hand: player.hand
    };
  
    if (card.rank === "13") { 
      player.hand.forEach(c => c.permanent_face_up = true); 
      response.message = "King played! Your cards are revealed.";
    } else if (card.rank === "11") {
      response.jack_swap_mode = true;
      response.message = "Jack played! Select a card to swap.";
    } else if (card.rank === "12") { 
      const nextPlayerIndex = (player_index + 1) % room.players.length;
      room.players[nextPlayerIndex].hand.push(card);
      room.centerCard = null;
      response.center_card = room.centerCard;
    }

    response.current_turn_index = room.currentTurnIndex;
    if (turnResult.game_over) {
      response = { ...response, ...turnResult };
    }

    console.log("Card played in room", room_id, "new center card:", room.centerCard, "new turn index:", room.currentTurnIndex);
    res.json(response);

  } catch (error) {
    console.error('Error in play_card:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Modified jack_swap endpoint
app.post("/jack_swap", (req, res) => {
  try {
    const { room_id, player_index, from_card_id, to_card_id } = req.body;
    
    if (!rooms[room_id]) {
      return res.status(404).json({
        status: 'error',
        message: 'Room not found'
      });
    }

    const room = rooms[room_id];

    if (player_index !== room.currentTurnIndex) {
      return res.status(403).json({ status: "error", message: "Not your turn" });
    }

    const player = room.players[player_index];
    const opponent = room.players.find(p => p.index !== player_index);
    const fromCardIndex = player.hand.findIndex(c => c.card_id === from_card_id);
    const toCardIndex = opponent.hand.findIndex(c => c.card_id === to_card_id);

    if (fromCardIndex === -1 || toCardIndex === -1) {
      return res.status(400).json({ status: "error", message: "Invalid card selection" });
    }

    const temp = player.hand[fromCardIndex];
    player.hand[fromCardIndex] = opponent.hand[toCardIndex];
    opponent.hand[toCardIndex] = temp;

    nextTurn(room_id);
    res.json({
      status: "ok",
      center_card: room.centerCard,
      current_turn_index: room.currentTurnIndex,
      player_hand: player.hand,
      opponent_hand_size: opponent.hand.length
    });
  } catch (error) {
    console.error("Error in jack_swap:", error);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
});

// Modified call_queens endpoint
app.post("/call_queens", (req, res) => {
  try {
    const { room_id, player_index } = req.body;
    
    if (!rooms[room_id]) {
      return res.status(404).json({
        status: 'error',
        message: 'Room not found'
      });
    }

    const room = rooms[room_id];

    if (player_index !== room.currentTurnIndex) {
      return res.status(403).json({ status: "error", message: "Not your turn" });
    }

    room.queensTriggered = true;
    room.queensPlayerIndex = player_index;
    room.finalRoundActive = true;
    room.finalTurnCount = 0;
    nextTurn(room_id);

    res.json({
      status: "ok",
      message: "Queens called! Final round started.",
      current_turn_index: room.currentTurnIndex
    });
  } catch (error) {
    console.error("Error in call_queens:", error);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
});

// Modified state endpoint
app.get("/state", (req, res) => {
  try {
    const { room_id } = req.query;
    
    if (!rooms[room_id]) {
      return res.status(404).json({
        status: 'error',
        message: 'Room not found'
      });
    }

    const room = rooms[room_id];
    
    res.json({
      center_card: room.centerCard,
      current_turn_index: room.currentTurnIndex,
      deck_count: room.deck.length,
      total_players: room.players.length,
      players: room.players.map(p => ({ 
        index: p.index, 
        hand_size: p.hand.length,
        hand: p.hand
      })),
      reaction_mode: room.reactionMode,
      reaction_value: room.reactionValue,
      queens_triggered: room.queensTriggered,
      final_round_active: room.finalRoundActive
    });
    console.log("State sent to client for room", room_id, "- center card:", room.centerCard, "turn index:", room.currentTurnIndex);
  } catch (error) {
    console.error('Error in state:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Modified reset endpoint
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

// New endpoint to list all rooms
app.get("/rooms", (req, res) => {
  try {
    const roomList = Object.entries(rooms).map(([id, room]) => ({
      room_id: id,
      player_count: room.players.length,
      max_players: MAX_PLAYERS
    }));
    
    res.json({
      status: 'ok',
      rooms: roomList
    });
  } catch (error) {
    console.error('Error listing rooms:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 