"""
train_model.py — Train a deepfake detection model using free datasets.

Free datasets to use:
  1. CIFAKE (Real vs AI-Generated images) — Kaggle
     https://www.kaggle.com/datasets/birdy654/cifake-real-and-ai-generated-synthetic-images
  2. 140k Real and Fake Faces — Kaggle
     https://www.kaggle.com/datasets/xhlulu/140k-real-and-fake-faces

Usage:
    python train_model.py --data_dir /path/to/dataset --epochs 20
"""

import os
import argparse
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models, optimizers, callbacks  # type: ignore
from tensorflow.keras.preprocessing.image import ImageDataGenerator  # type: ignore

IMG_SIZE = (224, 224)
BATCH_SIZE = 32


def build_model():
    """EfficientNetB0-based binary classifier."""
    base = tf.keras.applications.EfficientNetB0(
        include_top=False,
        weights="imagenet",
        input_shape=(*IMG_SIZE, 3),
    )
    base.trainable = False  # Feature extraction first

    model = models.Sequential([
        base,
        layers.GlobalAveragePooling2D(),
        layers.BatchNormalization(),
        layers.Dropout(0.3),
        layers.Dense(256, activation="relu"),
        layers.Dropout(0.2),
        layers.Dense(1, activation="sigmoid"),  # 0=Real, 1=Fake
    ])
    return model


def get_generators(data_dir):
    train_gen = ImageDataGenerator(
        rescale=1.0 / 255,
        rotation_range=15,
        width_shift_range=0.1,
        height_shift_range=0.1,
        horizontal_flip=True,
        zoom_range=0.1,
        validation_split=0.2,
    )
    train = train_gen.flow_from_directory(
        data_dir, target_size=IMG_SIZE, batch_size=BATCH_SIZE,
        class_mode="binary", subset="training",
    )
    val = train_gen.flow_from_directory(
        data_dir, target_size=IMG_SIZE, batch_size=BATCH_SIZE,
        class_mode="binary", subset="validation",
    )
    return train, val


def train(data_dir, epochs, output_path):
    train_ds, val_ds = get_generators(data_dir)
    model = build_model()

    model.compile(
        optimizer=optimizers.Adam(1e-3),
        loss="binary_crossentropy",
        metrics=["accuracy", tf.keras.metrics.AUC(name="auc")],
    )

    cb = [
        callbacks.EarlyStopping(patience=5, restore_best_weights=True),
        callbacks.ReduceLROnPlateau(factor=0.5, patience=3),
        callbacks.ModelCheckpoint(output_path, save_best_only=True),
    ]

    print("Phase 1: Training head (frozen base)…")
    model.fit(train_ds, validation_data=val_ds, epochs=epochs, callbacks=cb)

    # Fine-tune top layers of EfficientNet
    model.layers[0].trainable = True
    for layer in model.layers[0].layers[:-30]:
        layer.trainable = False

    model.compile(
        optimizer=optimizers.Adam(1e-5),
        loss="binary_crossentropy",
        metrics=["accuracy", tf.keras.metrics.AUC(name="auc")],
    )

    print("Phase 2: Fine-tuning top 30 layers…")
    model.fit(train_ds, validation_data=val_ds, epochs=epochs // 2, callbacks=cb)

    print(f"\nModel saved → {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data_dir", required=True, help="Dataset root (real/ and fake/ subdirs)")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--output", default="model/deepfake_model.h5")
    args = parser.parse_args()
    os.makedirs("model", exist_ok=True)
    train(args.data_dir, args.epochs, args.output)