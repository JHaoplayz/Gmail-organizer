"""
==========================================================
  Predictor del Mundial 2026 — Interfaz principal
==========================================================

Uso:
    python main.py                          # menú interactivo
    python main.py --train                  # entrenar y guardar modelo
    python main.py --match "Spain" "Italy"  # predecir un partido
    python main.py --simulate 500           # simulación Monte Carlo
    python main.py --full                   # análisis completo (recomendado)
"""

import argparse
import sys
import os
import warnings
warnings.filterwarnings("ignore")

# Añadimos el directorio actual al path
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import numpy as np
from tabulate import tabulate

from teams_data import TEAMS_RAW, COLUMNS, get_teams_df
from data_generator import generate_historical_dataset
from models import (
    prepare_features, build_models, evaluate_models,
    train_best_model, predict_match, feature_importance,
    FEATURE_COLS
)
from simulator import (
    simulate_group, simulate_tournament,
    monte_carlo_simulation, GROUPS
)
import visualizations as viz


def banner():
    print("""
╔══════════════════════════════════════════════════════╗
║        PREDICTOR ML — FIFA WORLD CUP 2026            ║
║   Modelo: Gradient Boosting + Random Forest + LR     ║
║   Simulación: Monte Carlo sobre 48 equipos           ║
╚══════════════════════════════════════════════════════╝
""")


def separador(titulo: str = ""):
    width = 56
    if titulo:
        pad = (width - len(titulo) - 2) // 2
        print(f"\n{'─' * pad} {titulo} {'─' * pad}")
    else:
        print(f"\n{'─' * width}")


def load_data_and_train(n_matches: int = 3000, verbose: bool = True):
    """Genera datos y entrena todos los modelos. Retorna (modelo_final, teams_df, X, y)."""
    if verbose:
        separador("DATOS Y ENTRENAMIENTO")
        print(f"Generando {n_matches} partidos históricos simulados...")

    df_hist = generate_historical_dataset(n_matches)

    if verbose:
        print(f"Dataset: {len(df_hist)} partidos")
        dist = df_hist["resultado"].value_counts()
        print(f"  Victorias (W): {dist.get('W',0)} ({dist.get('W',0)/len(df_hist)*100:.1f}%)")
        print(f"  Empates   (D): {dist.get('D',0)} ({dist.get('D',0)/len(df_hist)*100:.1f}%)")
        print(f"  Derrotas  (L): {dist.get('L',0)} ({dist.get('L',0)/len(df_hist)*100:.1f}%)")

    X, y = prepare_features(df_hist)
    models = build_models()

    results = evaluate_models(models, X, y)
    best_name = results.iloc[0]["Modelo"]

    if verbose:
        separador("EVALUACIÓN DE MODELOS (5-fold CV)")
        print("\n" + tabulate(results, headers="keys", tablefmt="rounded_outline", showindex=False))
        viz.plot_model_comparison(results)
        print(f"\n  Modelo seleccionado: {best_name}")

    model = train_best_model(models, X, y, best_name)

    teams_df = pd.DataFrame(TEAMS_RAW, columns=COLUMNS)

    if verbose:
        separador("IMPORTANCIA DE VARIABLES (Gradient Boosting)")
        imp = feature_importance(model, FEATURE_COLS)
        print("\n" + tabulate(imp, headers="keys", tablefmt="rounded_outline", showindex=False))
        viz.plot_feature_importance(imp, best_name)

        separador("CURVA DE APRENDIZAJE")
        print("Generando curva de aprendizaje (puede tardar 30s)...")
        viz.plot_learning_curve(model, X, y, "Gradient Boosting")

        separador("DISTRIBUCIÓN ELO — 48 EQUIPOS")
        teams_full = get_teams_df()
        viz.plot_elo_distribution(teams_full)

    return model, teams_df, X, y


def predict_single_match(model, teams_df: pd.DataFrame, name_a: str, name_b: str):
    """Predice y muestra el resultado de un partido."""
    row_a = teams_df[teams_df["pais"] == name_a]
    row_b = teams_df[teams_df["pais"] == name_b]

    if row_a.empty:
        print(f"  Error: No se encontró '{name_a}'. Verifica el nombre exacto.")
        return
    if row_b.empty:
        print(f"  Error: No se encontró '{name_b}'. Verifica el nombre exacto.")
        return

    team_a = row_a.iloc[0].to_dict()
    team_b = row_b.iloc[0].to_dict()

    pred = predict_match(model, team_a, team_b)

    print(f"""
  ┌─────────────────────────────────────┐
  │  {name_a:<18} vs  {name_b:<14}│
  │                                     │
  │  Victoria {name_a:<14}: {pred['prob_victoria_A']*100:5.1f}%       │
  │  Empate                  : {pred['prob_empate']*100:5.1f}%       │
  │  Victoria {name_b:<14}: {pred['prob_victoria_B']*100:5.1f}%       │
  │                                     │
  │  Predicción: {'VICTORIA ' + name_a if pred['prediccion']=='W' else ('EMPATE' if pred['prediccion']=='D' else 'VICTORIA ' + name_b):<27}│
  └─────────────────────────────────────┘""")


def show_group_predictions(model, teams_df: pd.DataFrame):
    """Muestra predicciones para todos los grupos."""
    separador("FASE DE GRUPOS — PREDICCIONES")
    for grupo, equipos in GROUPS.items():
        tabla = simulate_group(model, equipos, teams_df)
        print(f"\n  Grupo {grupo}: {' | '.join(equipos)}")
        print("  " + tabla[["Equipo", "PJ", "PG", "PE", "PP", "Pts"]].to_string(index=False, justify="left"))


def run_head_to_head(model, teams_df: pd.DataFrame):
    """Genera el heatmap de enfrentamientos entre los mejores equipos."""
    separador("HEATMAP H2H (Top 10)")
    print("Generando heatmap de enfrentamientos...")
    viz.plot_head_to_head_heatmap(model, teams_df)


def run_simulation(model, teams_df: pd.DataFrame, n_sims: int = 1000):
    """Ejecuta simulación Monte Carlo y muestra resultados."""
    separador(f"SIMULACIÓN MONTE CARLO ({n_sims} torneos)")
    mc = monte_carlo_simulation(model, teams_df, n_simulations=n_sims)

    print("\n  Top 15 candidatos al título:")
    print("  " + tabulate(mc.head(15), headers="keys",
                           tablefmt="rounded_outline", showindex=False))

    viz.plot_champion_probabilities(mc, top_n=12)
    return mc


def run_full_analysis(n_sims: int = 1000):
    """Análisis completo: entrenamiento + evaluación + predicciones + simulación."""
    banner()

    model, teams_df, X, y = load_data_and_train(verbose=True)

    separador("PARTIDOS DESTACADOS — PREDICCIONES")
    duelos = [
        ("Argentina", "Brazil"),
        ("France", "England"),
        ("Spain", "Germany"),
        ("Morocco", "Japan"),
        ("Argentina", "France"),
        ("Brazil", "Spain"),
    ]
    for a, b in duelos:
        predict_single_match(model, teams_df, a, b)

    show_group_predictions(model, teams_df)
    run_head_to_head(model, teams_df)
    mc_results = run_simulation(model, teams_df, n_sims=n_sims)

    separador("RESUMEN FINAL")
    top3 = mc_results.head(3)
    print(f"""
  Según {n_sims} simulaciones Monte Carlo:
  🥇 Favorito:  {top3.iloc[0]['Equipo']} ({top3.iloc[0]['Probabilidad_%']}%)
  🥈 Segundo:   {top3.iloc[1]['Equipo']} ({top3.iloc[1]['Probabilidad_%']}%)
  🥉 Tercero:   {top3.iloc[2]['Equipo']} ({top3.iloc[2]['Probabilidad_%']}%)

  Gráficos guardados en: world_cup_2026/graficos/
    - comparacion_modelos.png
    - importancia_features.png
    - probabilidades_campeon.png
    - heatmap_enfrentamientos.png
    - distribucion_elo.png
    - curva_aprendizaje.png
""")


def interactive_menu(model, teams_df: pd.DataFrame):
    """Menú interactivo por consola."""
    all_teams = sorted(teams_df["pais"].tolist())

    while True:
        print("""
  ┌── MENÚ PRINCIPAL ──────────────────────┐
  │  1. Predecir un partido                │
  │  2. Ver todos los equipos              │
  │  3. Simular fase de grupos             │
  │  4. Simulación Monte Carlo (500)       │
  │  5. Salir                              │
  └─────────────────────────────────────────┘""")
        opcion = input("  Selecciona [1-5]: ").strip()

        if opcion == "1":
            print(f"  Equipos disponibles:\n  {', '.join(all_teams)}")
            a = input("  Equipo A: ").strip()
            b = input("  Equipo B: ").strip()
            predict_single_match(model, teams_df, a, b)

        elif opcion == "2":
            tabla = teams_df[["pais", "ranking_fifa", "elo_rating",
                               "tasa_victorias", "copas_ganadas"]].sort_values("ranking_fifa")
            print("\n" + tabulate(tabla, headers="keys",
                                   tablefmt="rounded_outline", showindex=False))

        elif opcion == "3":
            show_group_predictions(model, teams_df)

        elif opcion == "4":
            run_simulation(model, teams_df, n_sims=500)

        elif opcion == "5":
            print("  ¡Hasta el próximo Mundial!")
            break
        else:
            print("  Opción no válida.")


# ─────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Predictor ML del Mundial 2026",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument("--match",    nargs=2, metavar=("EQUIPO_A", "EQUIPO_B"),
                        help="Predecir resultado de un partido")
    parser.add_argument("--simulate", type=int, metavar="N",
                        help="Simulación Monte Carlo con N torneos")
    parser.add_argument("--full",     action="store_true",
                        help="Análisis completo con todos los gráficos")
    parser.add_argument("--groups",   action="store_true",
                        help="Simular fase de grupos")
    parser.add_argument("--teams",    action="store_true",
                        help="Listar equipos clasificados")
    args = parser.parse_args()

    if args.full:
        run_full_analysis(n_sims=500)
        return

    # Para cualquier otro modo, entrenar primero (sin verbose)
    banner()
    print("Cargando modelo...")
    model, teams_df, X, y = load_data_and_train(verbose=False)
    print("Modelo listo.\n")

    if args.teams:
        tabla = teams_df[["pais", "ranking_fifa", "elo_rating",
                           "tasa_victorias", "copas_ganadas"]].sort_values("ranking_fifa")
        print(tabulate(tabla, headers="keys", tablefmt="rounded_outline", showindex=False))

    elif args.match:
        predict_single_match(model, teams_df, args.match[0], args.match[1])

    elif args.simulate:
        run_simulation(model, teams_df, n_sims=args.simulate)

    elif args.groups:
        show_group_predictions(model, teams_df)

    else:
        interactive_menu(model, teams_df)


if __name__ == "__main__":
    main()
