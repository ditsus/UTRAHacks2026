/**
 * Solana Actions Server Endpoint
 * Implements the Solana Actions specification for NFT minting
 * 
 * Run with: node server/actionEndpoint.js
 */

import express from 'express';
import cors from 'cors';
import { 
  Connection, 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  LAMPORTS_PER_SOL 
} from '@solana/web3.js';
import { createPostResponse, actionCorsHeaders } from '@solana/actions';

const app = express();
const PORT = 3001;

// Solana configuration
const SOLANA_RPC = 'https://api.devnet.solana.com';
const MINT_COST_SOL = 0.01;
const TREASURY_WALLET = 'GsfNSuZFrT2r4xzSndnCSs9tTXwt47etPqU8yFVnDcXd';

// CORS for Solana Actions
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Encoding'],
}));

// Add Solana Action headers
app.use((req, res, next) => {
  res.set(actionCorsHeaders());
  next();
});

app.use(express.json());

/**
 * GET /api/actions/mint
 * Returns the Action metadata for the mint operation
 */
app.get('/api/actions/mint', (req, res) => {
  const metadata = req.query.metadata ? JSON.parse(decodeURIComponent(req.query.metadata)) : null;
  
  const payload = {
    icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
    title: metadata?.name || 'Mint Robot Assembly',
    description: `Mint this custom robot assembly as a Compressed NFT on Solana. Cost: ${MINT_COST_SOL} SOL`,
    label: `Mint for ${MINT_COST_SOL} SOL`,
    links: {
      actions: [
        {
          label: `Mint for ${MINT_COST_SOL} SOL`,
          href: `/api/actions/mint?metadata=${encodeURIComponent(JSON.stringify(metadata || {}))}`,
        },
      ],
    },
  };

  console.log('GET /api/actions/mint - Returning payload:', payload.title);
  res.json(payload);
});

/**
 * POST /api/actions/mint
 * Processes the mint request and returns a transaction for signing
 */
app.post('/api/actions/mint', async (req, res) => {
  try {
    const { account } = req.body;
    const metadata = req.query.metadata ? JSON.parse(decodeURIComponent(req.query.metadata)) : {};

    if (!account) {
      return res.status(400).json({ error: 'Missing account in request body' });
    }

    console.log('POST /api/actions/mint - Account:', account);
    console.log('Metadata:', metadata.name);

    const connection = new Connection(SOLANA_RPC, 'confirmed');
    const payerPubkey = new PublicKey(account);
    const treasuryPubkey = new PublicKey(TREASURY_WALLET);

    // Create the transaction
    const transaction = new Transaction();

    // Add payment for minting
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: payerPubkey,
        toPubkey: treasuryPubkey,
        lamports: Math.floor(MINT_COST_SOL * LAMPORTS_PER_SOL),
      })
    );

    // In production, you would add cNFT minting instructions here
    // Using Metaplex Bubblegum for compressed NFTs
    // For now, we just do the payment

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.feePayer = payerPubkey;

    // Return the transaction for the wallet to sign
    const response = await createPostResponse({
      fields: {
        transaction,
        message: `Minting: ${metadata.name || 'Robot Assembly'}`,
      },
    });

    console.log('Transaction created successfully');
    res.json(response);

  } catch (error) {
    console.error('Error creating mint transaction:', error);
    res.status(500).json({ error: 'Failed to create transaction', details: error.message });
  }
});

/**
 * OPTIONS handler for CORS preflight
 */
app.options('/api/actions/mint', (req, res) => {
  res.set(actionCorsHeaders());
  res.sendStatus(200);
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Webhook endpoint for transaction confirmation (Helius-style)
 * In production, configure this with Helius webhooks
 */
app.post('/api/webhooks/transaction', (req, res) => {
  const { signature, success, metadata } = req.body;
  
  console.log('Transaction webhook received:', { signature, success });
  
  // In production, emit this to connected clients via WebSocket
  // For demo, we'll just log it
  
  res.json({ received: true });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║         Solana Actions Server Running                      ║
╠════════════════════════════════════════════════════════════╣
║  Local:    http://localhost:${PORT}                          ║
║  Action:   http://localhost:${PORT}/api/actions/mint         ║
║  Network:  Solana Devnet                                   ║
║  Cost:     ${MINT_COST_SOL} SOL per mint                            ║
╚════════════════════════════════════════════════════════════╝

To test the Action, use dial.to:
https://dial.to/?action=solana-action:http://localhost:${PORT}/api/actions/mint
  `);
});

export default app;
