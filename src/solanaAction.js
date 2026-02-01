/**
 * Solana Action utilities for minting robot assemblies as cNFTs
 * Uses Solana Actions/Blinks specification
 */

import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';

// Solana devnet for testing (switch to mainnet-beta for production)
const SOLANA_RPC = 'https://api.devnet.solana.com';
const MINT_COST_SOL = 0.01;

// Treasury wallet to receive mint payments (replace with your wallet)
const TREASURY_WALLET = 'GsfNSuZFrT2r4xzSndnCSs9tTXwt47etPqU8yFVnDcXd';

/**
 * Generate metadata for the robot assembly
 * @param {Object} sceneData - Data from the Three.js scene
 * @returns {Object} NFT metadata
 */
export function generateRobotMetadata(sceneData) {
  const { modelName, attachedParts, timestamp, thumbnailBase64 } = sceneData;
  
  const parts = attachedParts.map((part, index) => ({
    id: index,
    type: part.type,
    position: {
      x: part.position.x.toFixed(4),
      y: part.position.y.toFixed(4),
      z: part.position.z.toFixed(4)
    },
    color: part.color || '#444444'
  }));

  return {
    name: `Robot Assembly #${Date.now().toString(36).toUpperCase()}`,
    symbol: 'ROBO',
    description: `A custom robot assembly with ${parts.length} attached components. Built with gesture-based controls.`,
    image: thumbnailBase64 || 'https://placeholder.com/robot.png',
    external_url: 'https://utrahacks2026.vercel.app',
    attributes: [
      { trait_type: 'Base Model', value: modelName || 'Custom Robot' },
      { trait_type: 'Total Parts', value: parts.length },
      { trait_type: 'Servos', value: parts.filter(p => p.type === 'servo').length },
      { trait_type: 'Wheels', value: parts.filter(p => p.type === 'wheel').length },
      { trait_type: 'Created', value: new Date(timestamp).toISOString() }
    ],
    properties: {
      parts: parts,
      buildTimestamp: timestamp,
      version: '1.0.0'
    }
  };
}

/**
 * Create a Solana Action payload according to the Actions spec
 * @param {Object} metadata - Robot metadata
 * @returns {Object} Solana Action payload
 */
export function createActionPayload(metadata) {
  return {
    icon: metadata.image,
    title: `Mint: ${metadata.name}`,
    description: `Mint this robot assembly as a Compressed NFT on Solana. Cost: ${MINT_COST_SOL} SOL`,
    label: 'Mint Robot',
    links: {
      actions: [
        {
          label: `Mint for ${MINT_COST_SOL} SOL`,
          href: `/api/actions/mint?metadata=${encodeURIComponent(JSON.stringify(metadata))}`
        }
      ]
    }
  };
}

/**
 * Generate a Blink URL for the action
 * @param {string} actionUrl - The action endpoint URL
 * @returns {string} dial.to Blink URL
 */
export function generateBlinkUrl(actionUrl) {
  // dial.to converts Action URLs to scannable Blinks
  const encodedUrl = encodeURIComponent(actionUrl);
  return `https://dial.to/?action=solana-action:${encodedUrl}`;
}

/**
 * Create a mint transaction
 * @param {PublicKey} payerPubkey - The payer's public key
 * @param {Object} metadata - Robot metadata
 * @returns {Promise<Transaction>} Unsigned transaction
 */
export async function createMintTransaction(payerPubkey, metadata) {
  const connection = new Connection(SOLANA_RPC, 'confirmed');
  const treasuryPubkey = new PublicKey(TREASURY_WALLET);
  
  // Create a simple transfer transaction for the mint cost
  // In production, this would also include cNFT minting instructions
  const transaction = new Transaction();
  
  // Add payment instruction
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: payerPubkey,
      toPubkey: treasuryPubkey,
      lamports: MINT_COST_SOL * LAMPORTS_PER_SOL
    })
  );
  
  // Add memo with metadata hash for verification
  // In production, add actual cNFT minting via Metaplex Bubblegum
  const metadataHash = btoa(JSON.stringify(metadata)).slice(0, 32);
  
  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = payerPubkey;
  
  return transaction;
}

/**
 * Listen for transaction confirmation
 * @param {string} signature - Transaction signature
 * @param {Function} onConfirmed - Callback when confirmed
 * @param {Function} onError - Callback on error
 */
export async function listenForConfirmation(signature, onConfirmed, onError) {
  const connection = new Connection(SOLANA_RPC, 'confirmed');
  
  try {
    // Poll for confirmation (websocket would be better in production)
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      onError(new Error('Transaction failed'));
    } else {
      onConfirmed(signature);
    }
  } catch (error) {
    onError(error);
  }
}

/**
 * Capture scene snapshot for minting
 * @param {THREE.WebGLRenderer} renderer - Three.js renderer
 * @param {THREE.Scene} scene - Three.js scene
 * @param {THREE.Camera} camera - Three.js camera
 * @returns {string} Base64 encoded image
 */
export function captureSceneSnapshot(renderer, scene, camera) {
  // Render the scene
  renderer.render(scene, camera);
  
  // Get canvas data as base64
  const canvas = renderer.domElement;
  return canvas.toDataURL('image/png');
}

/**
 * Get assembly data from scene
 * @param {Object} sceneManager - SceneManager instance
 * @returns {Object} Assembly data
 */
export function getAssemblyData(sceneManager) {
  const attachedParts = sceneManager.attachedParts.map(part => {
    const worldPos = part.position.clone();
    return {
      type: part.userData.type,
      position: worldPos,
      color: part.children[0]?.material?.color?.getHexString() || '444444'
    };
  });

  return {
    modelName: sceneManager.currentModelName || 'Robot Assembly',
    attachedParts,
    timestamp: Date.now()
  };
}

export { SOLANA_RPC, MINT_COST_SOL, TREASURY_WALLET };
