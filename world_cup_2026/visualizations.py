"""
Visualizaciones para el análisis del Mundial 2026.
Genera y guarda gráficos educativos sobre el modelo y las predicciones.
"""

import matplotlib
matplotlib.use("Agg")   # backend sin pantalla (funciona en servidor)
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import seaborn as sns
import pandas as pd
import numpy as np
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "graficos"
OUTPUT_DIR.mkdir(exist_ok=True)

sns.set_theme(style="whitegrid", palette="muted")
COLORS = ["#1a237e", "#e53935", "#2e7d32", "#f57f17", "#6a1b9a"]


# ─────────────────────────────────────────────────────────────
# 1. Comparación de modelos
# ─────────────────────────────────────────────────────────────
def plot_model_comparison(results_df: pd.DataFrame, save: bool = True):
    """Gráfico de barras comparando accuracy y log-loss de los modelos."""
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    fig.suptitle("Comparación de Modelos ML - Mundial 2026", fontsize=14, fontweight="bold")

    modelos = results_df["Modelo"]
    colores = COLORS[:len(modelos)]

    # Accuracy
    axes[0].barh(modelos, results_df["Accuracy CV"], color=colores, edgecolor="white")
    axes[0].set_xlabel("Accuracy (validación cruzada 5-fold)")
    axes[0].set_title("Accuracy (mayor = mejor)")
    axes[0].set_xlim(0, 1)
    for i, v in enumerate(results_df["Accuracy CV"]):
        axes[0].text(v + 0.005, i, f"{v:.3f}", va="center", fontsize=10)

    # Log-Loss
    axes[1].barh(modelos, results_df["Log-Loss CV"], color=colores, edgecolor="white")
    axes[1].set_xlabel("Log-Loss (validación cruzada 5-fold)")
    axes[1].set_title("Log-Loss (menor = mejor)")
    for i, v in enumerate(results_df["Log-Loss CV"]):
        axes[1].text(v + 0.005, i, f"{v:.3f}", va="center", fontsize=10)

    plt.tight_layout()
    if save:
        path = OUTPUT_DIR / "comparacion_modelos.png"
        plt.savefig(path, dpi=150, bbox_inches="tight")
        print(f"Guardado: {path}")
    plt.close()


# ─────────────────────────────────────────────────────────────
# 2. Importancia de features
# ─────────────────────────────────────────────────────────────
def plot_feature_importance(importance_df: pd.DataFrame, model_name: str, save: bool = True):
    """Gráfico horizontal de importancia de variables."""
    fig, ax = plt.subplots(figsize=(9, 5))
    ax.barh(importance_df["feature"], importance_df["importancia_%"],
            color=COLORS[0], edgecolor="white")
    ax.set_xlabel("Importancia (%)")
    ax.set_title(f"Importancia de Variables — {model_name}", fontsize=13, fontweight="bold")

    for i, row in importance_df.iterrows():
        ax.text(row["importancia_%"] + 0.3, i,
                f"{row['importancia_%']:.1f}%", va="center", fontsize=9)

    ax.invert_yaxis()
    plt.tight_layout()
    if save:
        path = OUTPUT_DIR / "importancia_features.png"
        plt.savefig(path, dpi=150, bbox_inches="tight")
        print(f"Guardado: {path}")
    plt.close()


# ─────────────────────────────────────────────────────────────
# 3. Probabilidades del torneo (Monte Carlo)
# ─────────────────────────────────────────────────────────────
def plot_champion_probabilities(mc_df: pd.DataFrame, top_n: int = 12, save: bool = True):
    """Gráfico de barras con las probabilidades de ser campeón."""
    top = mc_df.head(top_n).copy()

    fig, ax = plt.subplots(figsize=(12, 6))

    bars = ax.bar(top["Equipo"], top["Probabilidad_%"],
                  color=sns.color_palette("Reds_r", len(top)),
                  edgecolor="white", linewidth=0.7)

    ax.set_ylabel("Probabilidad de ser Campeón (%)")
    ax.set_title("Probabilidades de Ganar el Mundial 2026\n(Simulación Monte Carlo)",
                 fontsize=13, fontweight="bold")
    ax.set_ylim(0, top["Probabilidad_%"].max() * 1.2)
    plt.xticks(rotation=30, ha="right")

    for bar, val in zip(bars, top["Probabilidad_%"]):
        ax.text(bar.get_x() + bar.get_width() / 2,
                bar.get_height() + 0.3,
                f"{val:.1f}%", ha="center", va="bottom", fontsize=9, fontweight="bold")

    plt.tight_layout()
    if save:
        path = OUTPUT_DIR / "probabilidades_campeon.png"
        plt.savefig(path, dpi=150, bbox_inches="tight")
        print(f"Guardado: {path}")
    plt.close()


# ─────────────────────────────────────────────────────────────
# 4. Heatmap de probabilidades entre equipos top
# ─────────────────────────────────────────────────────────────
def plot_head_to_head_heatmap(model, teams_df: pd.DataFrame,
                               top_teams: list = None, save: bool = True):
    """
    Heatmap de probabilidad de victoria del equipo fila contra el equipo columna.
    """
    from models import predict_match

    if top_teams is None:
        top_teams = ["Argentina", "Brazil", "France", "Spain", "England",
                     "Germany", "Portugal", "Netherlands", "Morocco", "Japan"]

    n = len(top_teams)
    matrix = np.zeros((n, n))

    for i, name_a in enumerate(top_teams):
        row_a = teams_df[teams_df["pais"] == name_a]
        if row_a.empty:
            continue
        team_a = row_a.iloc[0].to_dict()
        for j, name_b in enumerate(top_teams):
            if i == j:
                matrix[i][j] = 0.5
                continue
            row_b = teams_df[teams_df["pais"] == name_b]
            if row_b.empty:
                continue
            team_b = row_b.iloc[0].to_dict()
            pred = predict_match(model, team_a, team_b)
            matrix[i][j] = pred["prob_victoria_A"]

    df_heat = pd.DataFrame(matrix, index=top_teams, columns=top_teams)

    fig, ax = plt.subplots(figsize=(11, 9))
    sns.heatmap(df_heat, annot=True, fmt=".2f", cmap="RdYlGn",
                center=0.5, vmin=0.1, vmax=0.9,
                linewidths=0.5, linecolor="gray",
                cbar_kws={"label": "P(Victoria fila vs columna)"},
                ax=ax)
    ax.set_title("Probabilidad de Victoria entre Equipos Top\n(fila = equipo A, columna = equipo B)",
                 fontsize=12, fontweight="bold")
    ax.set_xlabel("Equipo B")
    ax.set_ylabel("Equipo A")
    plt.xticks(rotation=35, ha="right")
    plt.tight_layout()

    if save:
        path = OUTPUT_DIR / "heatmap_enfrentamientos.png"
        plt.savefig(path, dpi=150, bbox_inches="tight")
        print(f"Guardado: {path}")
    plt.close()


# ─────────────────────────────────────────────────────────────
# 5. Distribución ELO de los 48 equipos
# ─────────────────────────────────────────────────────────────
def plot_elo_distribution(teams_df: pd.DataFrame, save: bool = True):
    """Histograma + KDE del ELO de los 48 equipos clasificados."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    fig.suptitle("Distribución del ELO Rating — 48 Equipos Mundial 2026",
                 fontsize=13, fontweight="bold")

    # Histograma por confederación
    conf_cols = [c for c in teams_df.columns if c.startswith("conf_")]
    if conf_cols:
        teams_df["confederacion"] = teams_df[conf_cols].idxmax(axis=1).str.replace("conf_", "")

    if "confederacion" in teams_df.columns:
        for conf, group in teams_df.groupby("confederacion"):
            axes[0].hist(group["elo_rating"], bins=8, alpha=0.6, label=conf, edgecolor="white")
        axes[0].legend(fontsize=8)
    else:
        axes[0].hist(teams_df["elo_rating"], bins=12, color=COLORS[0], edgecolor="white")

    axes[0].set_xlabel("ELO Rating")
    axes[0].set_ylabel("Número de equipos")
    axes[0].set_title("Histograma por Confederación")

    # Scatter ELO vs Ranking FIFA
    axes[1].scatter(teams_df["ranking_fifa"], teams_df["elo_rating"],
                    s=60, alpha=0.7, color=COLORS[1], edgecolors="white", linewidth=0.5)
    axes[1].set_xlabel("Ranking FIFA (menor = mejor)")
    axes[1].set_ylabel("ELO Rating")
    axes[1].set_title("ELO vs Ranking FIFA\n(correlación esperada: inversa)")
    axes[1].invert_xaxis()

    # Anotamos los top 5
    top5 = teams_df.nsmallest(5, "ranking_fifa")
    for _, row in top5.iterrows():
        axes[1].annotate(row["pais"],
                         (row["ranking_fifa"], row["elo_rating"]),
                         textcoords="offset points", xytext=(5, 5), fontsize=8)

    plt.tight_layout()
    if save:
        path = OUTPUT_DIR / "distribucion_elo.png"
        plt.savefig(path, dpi=150, bbox_inches="tight")
        print(f"Guardado: {path}")
    plt.close()


# ─────────────────────────────────────────────────────────────
# 6. Curva de aprendizaje (learning curve)
# ─────────────────────────────────────────────────────────────
def plot_learning_curve(model, X: pd.DataFrame, y: pd.Series,
                         model_name: str, save: bool = True):
    """
    Curva de aprendizaje: muestra cómo el rendimiento mejora con más datos.
    Útil para detectar bias (underfitting) o variance (overfitting).
    """
    from sklearn.model_selection import learning_curve

    train_sizes, train_scores, val_scores = learning_curve(
        model, X, y,
        train_sizes=np.linspace(0.1, 1.0, 10),
        cv=5, scoring="accuracy", n_jobs=-1
    )

    train_mean = train_scores.mean(axis=1)
    train_std  = train_scores.std(axis=1)
    val_mean   = val_scores.mean(axis=1)
    val_std    = val_scores.std(axis=1)

    fig, ax = plt.subplots(figsize=(9, 5))
    ax.plot(train_sizes, train_mean, "o-", color=COLORS[0], label="Entrenamiento")
    ax.fill_between(train_sizes, train_mean - train_std,
                    train_mean + train_std, alpha=0.15, color=COLORS[0])
    ax.plot(train_sizes, val_mean, "s--", color=COLORS[1], label="Validación")
    ax.fill_between(train_sizes, val_mean - val_std,
                    val_mean + val_std, alpha=0.15, color=COLORS[1])

    ax.set_xlabel("Tamaño del conjunto de entrenamiento")
    ax.set_ylabel("Accuracy")
    ax.set_title(f"Curva de Aprendizaje — {model_name}", fontsize=12, fontweight="bold")
    ax.legend()
    ax.set_ylim(0, 1)
    ax.axhline(y=val_mean[-1], color="gray", linestyle=":", alpha=0.7,
               label=f"Val. final: {val_mean[-1]:.3f}")

    plt.tight_layout()
    if save:
        path = OUTPUT_DIR / "curva_aprendizaje.png"
        plt.savefig(path, dpi=150, bbox_inches="tight")
        print(f"Guardado: {path}")
    plt.close()


if __name__ == "__main__":
    print("Las visualizaciones se generan desde main.py")
