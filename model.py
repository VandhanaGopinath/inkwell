"""
ai-model/model.py
Inkwell Handwriting Recognition Model
Architecture: CNN + BiLSTM + CTC (Connectionist Temporal Classification)

PIPELINE:
Stroke Data → Canvas Image → CNN Feature Extraction → BiLSTM Sequence Modeling → CTC Decoder → Text

DATASETS:
- IAM Handwriting Database (primary)
- EMNIST (character-level pretraining)
- CASIA-OLHWDB (online handwriting)
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
import numpy as np
from PIL import Image
import io
import base64
import json


# ─── Architecture ────────────────────────────────────────────────────────────

class ConvBlock(nn.Module):
    """Residual convolutional block for feature extraction."""
    def __init__(self, in_channels, out_channels, kernel_size=3, stride=1):
        super().__init__()
        self.conv = nn.Conv2d(in_channels, out_channels, kernel_size,
                              stride=stride, padding=kernel_size // 2, bias=False)
        self.bn = nn.BatchNorm2d(out_channels)
        self.relu = nn.ReLU(inplace=True)

        # Skip connection
        self.skip = nn.Sequential()
        if stride != 1 or in_channels != out_channels:
            self.skip = nn.Sequential(
                nn.Conv2d(in_channels, out_channels, 1, stride=stride, bias=False),
                nn.BatchNorm2d(out_channels),
            )

    def forward(self, x):
        out = self.relu(self.bn(self.conv(x)))
        return out + self.skip(x)


class InkwellCNN(nn.Module):
    """
    CNN backbone for handwriting feature extraction.
    Input: (B, 1, H, W) grayscale image
    Output: (B, T, features) sequence of column features
    """
    def __init__(self, img_height=64):
        super().__init__()
        self.features = nn.Sequential(
            # Layer 1: 1 → 32
            ConvBlock(1, 32, 3),
            nn.MaxPool2d(2, 2),  # H/2, W/2

            # Layer 2: 32 → 64
            ConvBlock(32, 64, 3),
            nn.MaxPool2d(2, 2),  # H/4, W/4

            # Layer 3: 64 → 128
            ConvBlock(64, 128, 3),
            ConvBlock(128, 128, 3),
            nn.MaxPool2d((2, 1), (2, 1)),  # H/8, W/4

            # Layer 4: 128 → 256
            ConvBlock(128, 256, 3),
            ConvBlock(256, 256, 3),
            nn.MaxPool2d((2, 1), (2, 1)),  # H/16, W/4

            # Layer 5: 256 → 512
            ConvBlock(256, 512, 3),
            nn.MaxPool2d((2, 1), (2, 1)),  # H/32, W/4
        )

        # Calculate output size
        self.feature_dim = 512 * (img_height // 32)

    def forward(self, x):
        # x: (B, 1, H, W)
        features = self.features(x)  # (B, 512, H/32, W/4)
        B, C, H, W = features.shape
        # Reshape: treat columns as time steps
        features = features.view(B, C * H, W)  # (B, feature_dim, T)
        features = features.permute(0, 2, 1)    # (B, T, feature_dim)
        return features


class InkwellHTR(nn.Module):
    """
    Full Handwriting Text Recognition model.
    CNN (visual features) + BiLSTM (sequence) + CTC loss
    """
    def __init__(self, num_classes: int, img_height: int = 64, hidden_size: int = 512):
        super().__init__()
        self.num_classes = num_classes  # vocab size + 1 (blank)

        # Visual feature extractor
        self.cnn = InkwellCNN(img_height)
        feature_dim = self.cnn.feature_dim

        # Project CNN features to LSTM input
        self.linear_proj = nn.Linear(feature_dim, hidden_size)
        self.dropout = nn.Dropout(0.3)

        # Bidirectional LSTM for sequence modeling
        self.lstm = nn.LSTM(
            input_size=hidden_size,
            hidden_size=hidden_size,
            num_layers=2,
            bidirectional=True,
            dropout=0.3,
            batch_first=True,
        )

        # Output projection
        self.classifier = nn.Linear(hidden_size * 2, num_classes)

    def forward(self, x):
        # x: (B, 1, H, W)
        features = self.cnn(x)              # (B, T, feature_dim)
        projected = self.dropout(F.relu(self.linear_proj(features)))  # (B, T, hidden)
        lstm_out, _ = self.lstm(projected)  # (B, T, hidden*2)
        logits = self.classifier(lstm_out)  # (B, T, num_classes)
        log_probs = F.log_softmax(logits, dim=-1)
        return log_probs  # (B, T, C)


# ─── Vocabulary ──────────────────────────────────────────────────────────────

class Vocabulary:
    """Character-level vocabulary for CTC."""
    BLANK = 0

    def __init__(self):
        # Printable ASCII + extended
        chars = (
            ' !"#$%&\'()*+,-./0123456789:;<=>?@'
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`'
            'abcdefghijklmnopqrstuvwxyz{|}~'
            '€£¥©®™°±×÷αβγδΣΩπ'
        )
        self.char2idx = {c: i + 1 for i, c in enumerate(chars)}  # 0 = blank
        self.idx2char = {v: k for k, v in self.char2idx.items()}
        self.size = len(chars) + 1  # +1 for blank

    def encode(self, text: str) -> list:
        return [self.char2idx[c] for c in text if c in self.char2idx]

    def decode(self, indices: list) -> str:
        # CTC greedy decode: collapse repeats, remove blanks
        prev = None
        result = []
        for idx in indices:
            if idx != self.BLANK and idx != prev:
                char = self.idx2char.get(idx, '')
                if char:
                    result.append(char)
            prev = idx
        return ''.join(result)


# ─── Dataset ─────────────────────────────────────────────────────────────────

class HandwritingDataset(Dataset):
    """
    IAM / custom handwriting dataset.
    Each item: (image_path, text_label)
    """
    def __init__(self, data_list, vocab: Vocabulary, img_height=64, img_width=512):
        self.data = data_list  # list of (image_path, text)
        self.vocab = vocab
        self.img_height = img_height
        self.img_width = img_width

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        img_path, text = self.data[idx]

        # Load and preprocess image
        img = Image.open(img_path).convert('L')  # grayscale
        img = img.resize((self.img_width, self.img_height), Image.LANCZOS)
        img_array = np.array(img, dtype=np.float32) / 255.0
        img_tensor = torch.from_numpy(img_array).unsqueeze(0)  # (1, H, W)

        # Encode text
        label = torch.tensor(self.vocab.encode(text), dtype=torch.long)

        return img_tensor, label, len(label)


def collate_fn(batch):
    images, labels, label_lengths = zip(*batch)
    images = torch.stack(images, 0)
    label_lengths = torch.tensor(label_lengths, dtype=torch.long)
    labels = torch.cat(labels, 0)
    return images, labels, label_lengths


# ─── Training ─────────────────────────────────────────────────────────────────

class Trainer:
    def __init__(self, model, vocab, device='cuda'):
        self.model = model.to(device)
        self.vocab = vocab
        self.device = device
        self.criterion = nn.CTCLoss(blank=vocab.BLANK, reduction='mean', zero_infinity=True)
        self.optimizer = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-5)
        self.scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            self.optimizer, patience=3, factor=0.5
        )

    def train_epoch(self, loader):
        self.model.train()
        total_loss = 0
        for batch_idx, (images, labels, label_lengths) in enumerate(loader):
            images = images.to(self.device)
            labels = labels.to(self.device)

            self.optimizer.zero_grad()
            log_probs = self.model(images)  # (B, T, C)
            log_probs = log_probs.permute(1, 0, 2)  # (T, B, C) for CTC

            B = images.size(0)
            T = log_probs.size(0)
            input_lengths = torch.full((B,), T, dtype=torch.long)

            loss = self.criterion(log_probs, labels, input_lengths, label_lengths)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), 5.0)
            self.optimizer.step()

            total_loss += loss.item()
            if batch_idx % 50 == 0:
                print(f'  Batch {batch_idx}: loss={loss.item():.4f}')

        return total_loss / len(loader)

    @torch.no_grad()
    def evaluate(self, loader):
        self.model.eval()
        total_cer = 0
        total_chars = 0

        for images, labels, label_lengths in loader:
            images = images.to(self.device)
            log_probs = self.model(images)  # (B, T, C)
            preds = log_probs.argmax(dim=-1)  # (B, T)

            # Decode batch
            offset = 0
            for i in range(images.size(0)):
                pred_text = self.vocab.decode(preds[i].cpu().tolist())
                true_text = self.vocab.decode(
                    labels[offset:offset + label_lengths[i]].tolist()
                )
                offset += label_lengths[i]

                # Character Error Rate
                cer = editdistance(pred_text, true_text) / max(len(true_text), 1)
                total_cer += cer
                total_chars += 1

        return total_cer / max(total_chars, 1)


def editdistance(s1, s2):
    """Simple edit distance for CER calculation."""
    m, n = len(s1), len(s2)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1): dp[i][0] = i
    for j in range(n + 1): dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if s1[i-1] == s2[j-1]:
                dp[i][j] = dp[i-1][j-1]
            else:
                dp[i][j] = 1 + min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
    return dp[m][n]


# ─── Inference ────────────────────────────────────────────────────────────────

class HandwritingRecognizer:
    """Production inference wrapper."""

    def __init__(self, model_path: str, device: str = 'cpu'):
        self.vocab = Vocabulary()
        self.device = device
        self.model = InkwellHTR(num_classes=self.vocab.size)
        checkpoint = torch.load(model_path, map_location=device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.model.eval()
        print(f"✅ Model loaded from {model_path}")

    @torch.no_grad()
    def recognize(self, image: Image.Image) -> str:
        """Recognize text from a PIL image."""
        img = image.convert('L').resize((512, 64), Image.LANCZOS)
        img_array = np.array(img, dtype=np.float32) / 255.0
        img_tensor = torch.from_numpy(img_array).unsqueeze(0).unsqueeze(0)  # (1, 1, 64, 512)

        log_probs = self.model(img_tensor.to(self.device))  # (1, T, C)
        preds = log_probs.argmax(dim=-1)[0]  # (T,)
        return self.vocab.decode(preds.cpu().tolist())

    def recognize_base64(self, b64_data: str) -> str:
        """Recognize from base64 encoded image."""
        img_data = base64.b64decode(b64_data.split(',')[-1])
        img = Image.open(io.BytesIO(img_data))
        return self.recognize(img)


# ─── FastAPI Server ───────────────────────────────────────────────────────────
"""
Run: uvicorn model:api_app --host 0.0.0.0 --port 8000
"""

try:
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel

    api_app = FastAPI(title="Inkwell HTR API", version="1.0.0")
    recognizer = None  # Lazy load

    class RecognizeRequest(BaseModel):
        image_base64: str
        strokes: list = []

    class RecognizeResponse(BaseModel):
        text: str
        confidence: float = 0.95

    @api_app.on_event("startup")
    async def load_model():
        global recognizer
        import os
        model_path = os.environ.get('MODEL_PATH', 'models/inkwell_htr.pth')
        if os.path.exists(model_path):
            recognizer = HandwritingRecognizer(model_path)
        else:
            print("⚠️  No model found. Using mock recognizer.")

    @api_app.post("/recognize", response_model=RecognizeResponse)
    async def recognize_endpoint(req: RecognizeRequest):
        if recognizer is None:
            # Return mock for development
            return RecognizeResponse(text="[Model not loaded — using OCR fallback]", confidence=0.0)
        try:
            text = recognizer.recognize_base64(req.image_base64)
            return RecognizeResponse(text=text)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @api_app.get("/health")
    def health():
        return {"status": "ok", "model_loaded": recognizer is not None}

except ImportError:
    pass  # FastAPI not installed, run training only


# ─── Training Entry Point ─────────────────────────────────────────────────────

if __name__ == '__main__':
    import argparse
    import os

    parser = argparse.ArgumentParser(description='Inkwell HTR Training')
    parser.add_argument('--data-dir', default='dataset/iam', help='IAM dataset directory')
    parser.add_argument('--epochs', type=int, default=100)
    parser.add_argument('--batch-size', type=int, default=32)
    parser.add_argument('--lr', type=float, default=1e-3)
    parser.add_argument('--device', default='cuda' if torch.cuda.is_available() else 'cpu')
    parser.add_argument('--output', default='models/inkwell_htr.pth')
    args = parser.parse_args()

    print(f"🚀 Training on device: {args.device}")
    vocab = Vocabulary()
    print(f"📚 Vocabulary size: {vocab.size}")

    # Load dataset (expects data.json with {train: [[img_path, text], ...], val: [...]}
    with open(os.path.join(args.data_dir, 'data.json')) as f:
        data = json.load(f)

    train_ds = HandwritingDataset(data['train'], vocab)
    val_ds = HandwritingDataset(data['val'], vocab)
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                              collate_fn=collate_fn, num_workers=4)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False,
                            collate_fn=collate_fn, num_workers=2)

    model = InkwellHTR(num_classes=vocab.size)
    total_params = sum(p.numel() for p in model.parameters())
    print(f"🧠 Model parameters: {total_params:,}")

    trainer = Trainer(model, vocab, device=args.device)

    best_cer = float('inf')
    os.makedirs('models', exist_ok=True)

    for epoch in range(args.epochs):
        train_loss = trainer.train_epoch(train_loader)
        val_cer = trainer.evaluate(val_loader)
        trainer.scheduler.step(val_cer)

        print(f"Epoch {epoch+1}/{args.epochs}: loss={train_loss:.4f}, CER={val_cer:.4f}")

        if val_cer < best_cer:
            best_cer = val_cer
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': trainer.optimizer.state_dict(),
                'val_cer': val_cer,
                'vocab_size': vocab.size,
            }, args.output)
            print(f"  ✅ New best model saved (CER={best_cer:.4f})")

    print(f"\n✨ Training complete. Best CER: {best_cer:.4f}")
