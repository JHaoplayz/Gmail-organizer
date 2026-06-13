"""
Generador de partidos históricos para entrenar el modelo.
Simula mundiales 2006-2022 usando estadísticas reales de los equipos
con algo de aleatoriedad para replicar la variabilidad del fútbol.
"""

import numpy as np
import pandas as pd
from teams_data import TEAMS_RAW, COLUMNS


RNG = np.random.default_rng(42)


def _expected_score(elo_a: float, elo_b: float) -> float:
    """
    Probabilidad de victoria de A sobre B usando la fórmula ELO estándar.
    Esta es la misma fórmula que usa la FIFA desde 2018.
    """
    return 1 / (1 + 10 ** ((elo_b - elo_a) / 400))


def generate_match(team_a: dict, team_b: dict, neutral: bool = True) -> dict:
    """
    Genera el resultado de un partido entre dos equipos.

    Usa el ELO para calcular probabilidades base y luego
    muestrea el resultado con distribución de Poisson para los goles.

    Parámetros:
        team_a, team_b : diccionarios con datos del equipo
        neutral        : si el campo es neutral (False añade ventaja local)

    Retorna:
        dict con goles_a, goles_b y resultado (W/D/L desde perspectiva de A)
    """
    elo_a = team_a["elo_rating"]
    elo_b = team_b["elo_rating"]

    # Ventaja de campo local: +100 ELO puntos
    if not neutral:
        elo_a += 100

    # Probabilidad esperada de victoria para A
    prob_a_wins = _expected_score(elo_a, elo_b)

    # Media de goles usando distribución de Poisson
    # Los mejores equipos marcan más y encajan menos
    lambda_a = (team_a["media_goles_favor"] * 0.6 +
                (2 - team_b["media_goles_contra"]) * 0.4) * prob_a_wins / 0.5
    lambda_b = (team_b["media_goles_favor"] * 0.6 +
                (2 - team_a["media_goles_contra"]) * 0.4) * (1 - prob_a_wins) / 0.5

    # Aseguramos lambdas positivas razonables
    lambda_a = max(0.3, min(lambda_a, 4.0))
    lambda_b = max(0.3, min(lambda_b, 4.0))

    goles_a = RNG.poisson(lambda_a)
    goles_b = RNG.poisson(lambda_b)

    if goles_a > goles_b:
        resultado = "W"
    elif goles_a < goles_b:
        resultado = "L"
    else:
        resultado = "D"

    return {
        "equipo_a":      team_a["pais"],
        "equipo_b":      team_b["pais"],
        "elo_a":         team_a["elo_rating"],
        "elo_b":         team_b["elo_rating"],
        "ranking_a":     team_a["ranking_fifa"],
        "ranking_b":     team_b["ranking_fifa"],
        "goles_a":       goles_a,
        "goles_b":       goles_b,
        "dif_goles":     goles_a - goles_b,
        "dif_elo":       elo_a - elo_b,
        "dif_ranking":   team_b["ranking_fifa"] - team_a["ranking_fifa"],
        "resultado":     resultado,  # W/D/L desde perspectiva de equipo_a
    }


def generate_historical_dataset(n_matches: int = 3000) -> pd.DataFrame:
    """
    Genera n_matches partidos históricos aleatorios entre equipos del mundial.
    Estos datos simulan los ~3000 partidos internacionales que los modelos
    de predicción reales utilizan para entrenarse.
    """
    teams_df = pd.DataFrame(TEAMS_RAW, columns=COLUMNS)
    teams = teams_df.to_dict("records")

    matches = []
    for _ in range(n_matches):
        # Seleccionamos dos equipos distintos al azar
        idx_a, idx_b = RNG.choice(len(teams), size=2, replace=False)
        match = generate_match(teams[idx_a], teams[idx_b], neutral=True)
        matches.append(match)

    df = pd.DataFrame(matches)

    # También generamos ~800 partidos de Copa del Mundo histórica
    # donde los equipos sin copas son más débiles (aprox)
    wc_matches = []
    wc_teams = [t for t in teams if t["partidos_wc"] > 0]
    for _ in range(800):
        idx_a, idx_b = RNG.choice(len(wc_teams), size=2, replace=False)
        match = generate_match(wc_teams[idx_a], wc_teams[idx_b], neutral=True)
        match["es_mundial"] = 1
        wc_matches.append(match)

    df_wc = pd.DataFrame(wc_matches)
    df["es_mundial"] = 0

    dataset = pd.concat([df, df_wc], ignore_index=True).sample(frac=1, random_state=42)
    return dataset


if __name__ == "__main__":
    df = generate_historical_dataset(3000)
    print(f"Dataset generado: {len(df)} partidos")
    print(df["resultado"].value_counts())
    print(df.head())
