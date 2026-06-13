"""
Simulador del torneo Mundial 2026.

Estructura del torneo:
  - 48 equipos en 12 grupos de 4
  - Los 2 primeros de cada grupo + los 8 mejores terceros → 32 equipos
  - Ronda de 32 → Octavos → Cuartos → Semis → Final
  - Simulación Monte Carlo: ejecuta el torneo N veces para obtener
    probabilidades robustas de cada equipo
"""

import numpy as np
import pandas as pd
from itertools import combinations
from models import predict_match
from teams_data import TEAMS_RAW, COLUMNS

RNG = np.random.default_rng(42)


# ─────────────────────────────────────────────────────────────
# Grupos del Mundial 2026 (sorteo hipotético)
# ─────────────────────────────────────────────────────────────
GROUPS = {
    "A": ["Argentina", "USA",          "Morocco",     "Japan"],
    "B": ["France",    "Mexico",        "Senegal",     "South Korea"],
    "C": ["England",   "Brazil",        "Nigeria",     "Iran"],
    "D": ["Spain",     "Colombia",      "Egypt",       "Australia"],
    "E": ["Portugal",  "Germany",       "Ivory Coast", "Canada"],
    "F": ["Netherlands","Uruguay",      "Cameroon",    "Turkey"],
    "G": ["Belgium",   "Italy",         "Ghana",       "Saudi Arabia"],
    "H": ["Croatia",   "Switzerland",   "Tunisia",     "Japan"],  # solapado→sim only
    "I": ["Denmark",   "Ecuador",       "Algeria",     "Iraq"],
    "J": ["Austria",   "Poland",        "South Africa","Jordan"],
    "K": ["Ukraine",   "Serbia",        "New Zealand", "Bolivia"],
    "L": ["Scotland",  "Venezuela",     "Costa Rica",  "Uzbekistan"],
}

# Re-asignamos Japan para evitar duplicado (solo en demo)
GROUPS["H"] = ["Croatia", "Switzerland", "Tunisia", "Uzbekistan"]


def _get_team(name: str, teams_df: pd.DataFrame) -> dict:
    row = teams_df[teams_df["pais"] == name]
    if row.empty:
        return {"pais": name, "elo_rating": 1600, "ranking_fifa": 80}
    return row.iloc[0].to_dict()


def simulate_match_proba(model, team_a: dict, team_b: dict) -> str:
    """
    Simula un partido de fase de grupos donde el empate es posible.
    Devuelve 'W', 'D' o 'L' desde la perspectiva del equipo_a.
    """
    from models import predict_match
    pred = predict_match(model, team_a, team_b)
    probs = np.array([pred["prob_victoria_A"], pred["prob_empate"], pred["prob_victoria_B"]])
    probs = probs / probs.sum()   # normaliza para evitar errores de punto flotante
    return RNG.choice(["W", "D", "L"], p=probs)


def simulate_knockout_match(model, team_a: dict, team_b: dict) -> str:
    """
    En eliminatorias no hay empate: si hay empate hay penaltis (50/50).
    Retorna el nombre del equipo ganador.
    """
    pred = predict_match(model, team_a, team_b)

    # Si empate en 90', penaltis: 50% cada equipo
    p_a = pred["prob_victoria_A"] + pred["prob_empate"] * 0.5
    p_b = pred["prob_victoria_B"] + pred["prob_empate"] * 0.5

    return team_a["pais"] if RNG.random() < p_a else team_b["pais"]


def simulate_group(model, group_teams: list, teams_df: pd.DataFrame) -> pd.DataFrame:
    """
    Simula la fase de grupos (todos contra todos).
    Sistema de puntos: Victoria=3, Empate=1, Derrota=0.
    """
    tabla = {t: {"PJ": 0, "PG": 0, "PE": 0, "PP": 0,
                 "GF": 0, "GC": 0, "Pts": 0} for t in group_teams}

    for team_a_name, team_b_name in combinations(group_teams, 2):
        team_a = _get_team(team_a_name, teams_df)
        team_b = _get_team(team_b_name, teams_df)

        resultado = simulate_match_proba(model, team_a, team_b)

        tabla[team_a_name]["PJ"] += 1
        tabla[team_b_name]["PJ"] += 1

        if resultado == "W":
            tabla[team_a_name]["PG"] += 1
            tabla[team_b_name]["PP"] += 1
            tabla[team_a_name]["Pts"] += 3
        elif resultado == "D":
            tabla[team_a_name]["PE"] += 1
            tabla[team_b_name]["PE"] += 1
            tabla[team_a_name]["Pts"] += 1
            tabla[team_b_name]["Pts"] += 1
        else:
            tabla[team_b_name]["PG"] += 1
            tabla[team_a_name]["PP"] += 1
            tabla[team_b_name]["Pts"] += 3

    df = pd.DataFrame(tabla).T.reset_index()
    df.columns = ["Equipo"] + list(df.columns[1:])
    df = df.sort_values(["Pts", "PG"], ascending=False).reset_index(drop=True)
    return df


def simulate_tournament(model, teams_df: pd.DataFrame) -> str:
    """
    Simula el torneo completo desde grupos hasta la final.
    Retorna el nombre del campeón.
    """
    # Fase de grupos
    clasificados = []
    terceros = []

    for grupo, equipos in GROUPS.items():
        tabla = simulate_group(model, equipos, teams_df)
        clasificados.append(tabla.iloc[0]["Equipo"])  # 1ro
        clasificados.append(tabla.iloc[1]["Equipo"])  # 2do
        terceros.append((tabla.iloc[2]["Equipo"], tabla.iloc[2]["Pts"]))

    # Los 8 mejores terceros también pasan
    terceros.sort(key=lambda x: x[1], reverse=True)
    clasificados += [t[0] for t in terceros[:8]]

    # Ahora 32 equipos en eliminatorias
    ronda = clasificados
    while len(ronda) > 1:
        siguiente_ronda = []
        for i in range(0, len(ronda), 2):
            team_a = _get_team(ronda[i], teams_df)
            team_b = _get_team(ronda[i + 1], teams_df)
            ganador = simulate_knockout_match(model, team_a, team_b)
            siguiente_ronda.append(ganador)
        ronda = siguiente_ronda

    return ronda[0]


def monte_carlo_simulation(model, teams_df: pd.DataFrame,
                           n_simulations: int = 1000) -> pd.DataFrame:
    """
    Ejecuta el torneo N veces y cuenta cuántas veces gana cada equipo.

    Monte Carlo es ideal para sistemas con alta variabilidad como el fútbol:
    aunque Argentina tiene mayor probabilidad, en un solo torneo puede
    caer en cuartos por un mal día. Con 1000 simulaciones obtenemos
    una distribución realista de campeones probables.
    """
    all_teams = list(teams_df["pais"])
    conteo = {t: 0 for t in all_teams}

    print(f"Ejecutando {n_simulations} simulaciones Monte Carlo...")
    for i in range(n_simulations):
        if (i + 1) % 200 == 0:
            print(f"  {i+1}/{n_simulations} simulaciones completadas")
        campeon = simulate_tournament(model, teams_df)
        if campeon in conteo:
            conteo[campeon] += 1

    results = pd.DataFrame([
        {"Equipo": equipo, "Victorias": v,
         "Probabilidad_%": round(v / n_simulations * 100, 1)}
        for equipo, v in conteo.items()
    ])
    results = results.sort_values("Probabilidad_%", ascending=False)
    results = results[results["Victorias"] > 0].reset_index(drop=True)
    return results


# ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    from models import (generate_historical_dataset, prepare_features,
                        build_models, train_best_model)

    print("Entrenando modelo...")
    df = generate_historical_dataset(3000)
    X, y = prepare_features(df)
    models = build_models()
    model = train_best_model(models, X, y, "Gradient Boosting")

    teams_df_raw = pd.DataFrame(TEAMS_RAW, columns=COLUMNS)

    print("\nSimulando torneo completo...")
    campeon = simulate_tournament(model, teams_df_raw)
    print(f"Campeón de la simulación: {campeon}")

    print()
    mc_results = monte_carlo_simulation(model, teams_df_raw, n_simulations=500)
    print("\nTop 10 candidatos al título (Monte Carlo 500 sims):")
    print(mc_results.head(10).to_string(index=False))
