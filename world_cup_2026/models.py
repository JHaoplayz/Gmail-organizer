"""
Pipeline de Machine Learning para predicción de partidos del Mundial 2026.

Modelos incluidos (de menos a más complejo):
  1. Regresión Logística   — lineal, muy interpretable, buen punto de partida
  2. Random Forest         — conjunto de árboles, captura no-linealidades
  3. Gradient Boosting     — boosting secuencial, mejor rendimiento general

Métricas de evaluación:
  - Accuracy: porcentaje de predicciones correctas
  - Log-loss: penaliza predicciones muy incorrectas con alta confianza
  - ROC-AUC:  qué tan bien separa victorias de derrotas (curva ROC)
"""

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.model_selection import cross_val_score, StratifiedKFold
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    accuracy_score, log_loss, roc_auc_score,
    classification_report, confusion_matrix
)
from sklearn.pipeline import Pipeline
import warnings
warnings.filterwarnings("ignore")

from data_generator import generate_historical_dataset


# ─────────────────────────────────────────────────────────────
# Features usadas para entrenar los modelos
# ─────────────────────────────────────────────────────────────
FEATURE_COLS = [
    "dif_elo",        # diferencia de puntos ELO (principal predictor)
    "dif_ranking",    # diferencia de ranking FIFA (mayor = mejor A)
    "elo_a",          # ELO absoluto del equipo A
    "elo_b",          # ELO absoluto del equipo B
    "ranking_a",      # Ranking FIFA de A
    "ranking_b",      # Ranking FIFA de B
    "es_mundial",     # si es un partido de copa del mundo
]

TARGET_COL = "resultado"   # W / D / L


def prepare_features(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """Separa features (X) y etiqueta (y) del dataset."""
    X = df[FEATURE_COLS].copy()
    y = df[TARGET_COL].copy()
    return X, y


def build_models() -> dict:
    """
    Devuelve un diccionario con los tres modelos en un Pipeline
    que incluye escalado de features.

    StandardScaler es necesario para Regresión Logística (sensible a escala),
    y también ayuda al Gradient Boosting. Random Forest es invariante a la
    escala pero lo incluimos igualmente por consistencia.
    """
    return {
        "Regresion Logistica": Pipeline([
            ("scaler", StandardScaler()),
            ("modelo", LogisticRegression(
                max_iter=1000,
                C=1.0,           # inverso de la regularización L2
                solver="lbfgs",
                random_state=42,
            )),
        ]),
        "Random Forest": Pipeline([
            ("scaler", StandardScaler()),
            ("modelo", RandomForestClassifier(
                n_estimators=200,    # 200 árboles
                max_depth=8,         # limita sobreajuste
                min_samples_leaf=5,  # mínimo de muestras en hoja
                random_state=42,
                n_jobs=-1,
            )),
        ]),
        "Gradient Boosting": Pipeline([
            ("scaler", StandardScaler()),
            ("modelo", GradientBoostingClassifier(
                n_estimators=300,    # 300 boosting rounds
                learning_rate=0.05, # paso pequeño = más estable
                max_depth=4,
                subsample=0.8,       # stochastic GBM (evita sobreajuste)
                random_state=42,
            )),
        ]),
    }


def evaluate_models(models: dict, X: pd.DataFrame, y: pd.Series) -> pd.DataFrame:
    """
    Evalúa todos los modelos con validación cruzada de 5 pliegues.

    La validación cruzada (k-fold CV) es la forma estándar de estimar
    el rendimiento real de un modelo cuando el dataset no es enorme.
    Dividimos los datos en 5 partes, entrenamos con 4 y evaluamos con 1,
    rotando el pliegue de validación.
    """
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    results = []

    for nombre, pipeline in models.items():
        print(f"  Evaluando {nombre}...")

        # Accuracy: fracción de predicciones correctas
        acc = cross_val_score(pipeline, X, y, cv=cv, scoring="accuracy").mean()

        # Log-loss: mide la calidad de las probabilidades (menor = mejor)
        ll = -cross_val_score(pipeline, X, y, cv=cv, scoring="neg_log_loss").mean()

        results.append({
            "Modelo":          nombre,
            "Accuracy CV":     round(acc, 4),
            "Log-Loss CV":     round(ll, 4),
        })
        print(f"    Accuracy={acc:.3f}  Log-Loss={ll:.3f}")

    return pd.DataFrame(results).sort_values("Accuracy CV", ascending=False)


def train_best_model(models: dict, X: pd.DataFrame, y: pd.Series,
                     best_name: str = "Gradient Boosting"):
    """
    Entrena el mejor modelo en todo el dataset y lo devuelve.
    En producción haríamos hyperparameter tuning con GridSearchCV,
    pero para fines educativos usamos los hiperparámetros fijos.
    """
    best = models[best_name]
    best.fit(X, y)
    return best


def predict_match(model, team_a: dict, team_b: dict) -> dict:
    """
    Predice el resultado de un partido entre dos equipos.

    Parámetros:
        model  : modelo entrenado (sklearn Pipeline)
        team_a : dict con datos del equipo A (necesita elo_rating, ranking_fifa)
        team_b : dict con datos del equipo B

    Retorna:
        dict con probabilidades W/D/L y predicción final
    """
    features = pd.DataFrame([{
        "dif_elo":       team_a["elo_rating"] - team_b["elo_rating"],
        "dif_ranking":   team_b["ranking_fifa"] - team_a["ranking_fifa"],
        "elo_a":         team_a["elo_rating"],
        "elo_b":         team_b["elo_rating"],
        "ranking_a":     team_a["ranking_fifa"],
        "ranking_b":     team_b["ranking_fifa"],
        "es_mundial":    1,
    }])

    proba = model.predict_proba(features)[0]
    clases = model.classes_  # orden: D, L, W

    prob_dict = dict(zip(clases, proba))
    prediccion = clases[np.argmax(proba)]

    return {
        "prob_victoria_A": round(prob_dict.get("W", 0), 3),
        "prob_empate":     round(prob_dict.get("D", 0), 3),
        "prob_victoria_B": round(prob_dict.get("L", 0), 3),
        "prediccion":      prediccion,  # W=gana A, D=empate, L=gana B
    }


def feature_importance(model, feature_names: list) -> pd.DataFrame:
    """
    Extrae la importancia de cada feature del Random Forest o Gradient Boosting.
    Para Regresión Logística extrae los coeficientes en su lugar.
    """
    estimator = model.named_steps["modelo"]

    if hasattr(estimator, "feature_importances_"):
        importances = estimator.feature_importances_
    elif hasattr(estimator, "coef_"):
        # Para multiclase tomamos el máximo absoluto entre clases
        importances = np.abs(estimator.coef_).max(axis=0)
    else:
        return pd.DataFrame()

    df = pd.DataFrame({
        "feature":    feature_names,
        "importancia": importances,
    }).sort_values("importancia", ascending=False)

    df["importancia_%"] = (df["importancia"] / df["importancia"].sum() * 100).round(1)
    return df


# ─────────────────────────────────────────────────────────────
# Script de demostración rápida
# ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Generando dataset...")
    df = generate_historical_dataset(3000)

    X, y = prepare_features(df)
    models = build_models()

    print("\nEvaluando modelos con validación cruzada (5-fold)...")
    resultados = evaluate_models(models, X, y)
    print("\n=== Resultados ===")
    print(resultados.to_string(index=False))

    print("\nEntrenando Gradient Boosting en dataset completo...")
    modelo_final = train_best_model(models, X, y, "Gradient Boosting")

    equipo_arg = {"pais": "Argentina", "elo_rating": 2079, "ranking_fifa": 1}
    equipo_fra = {"pais": "France",    "elo_rating": 1987, "ranking_fifa": 3}

    pred = predict_match(modelo_final, equipo_arg, equipo_fra)
    print(f"\nArgentina vs France:")
    print(f"  Victoria Argentina: {pred['prob_victoria_A']*100:.1f}%")
    print(f"  Empate:             {pred['prob_empate']*100:.1f}%")
    print(f"  Victoria France:    {pred['prob_victoria_B']*100:.1f}%")
