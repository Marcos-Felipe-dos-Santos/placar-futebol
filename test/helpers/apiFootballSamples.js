/**
 * Recortes VERBATIM de `live-sample.json` (GET /fixtures?live=all, 19 partidas
 * ao vivo, capturado em 2026-09-03 via Invoke-WebRequest, sem reserializacao
 * do PowerShell).
 *
 * Copiados sem edicao. Se um valor aqui divergir do arquivo, o teste esta
 * medindo uma reconstrucao e nao o shape real. O `live-sample.json` nao e
 * versionado (58 KB de payload cru), entao estes recortes sao a unica
 * evidencia do shape que acompanha o repositorio.
 *
 * ESTES SAO PAYLOAD DE PROVEDOR. So testes de `src/adapters/` podem usa-los;
 * teste de `src/core/` usa fixture sintetica do modelo interno.
 *
 * Cobertura do que existe no arquivo: status `1H` e `2H`, com e sem
 * `status.extra`, e o caso de `elapsed` saturado em 90. `HT`, `FT` e os
 * demais codigos NAO tem exemplo real aqui.
 *
 * @module test/helpers/apiFootballSamples
 */

export const primeiroTempo = {
  "fixture": {
    "id": 1611381,
    "referee": null,
    "timezone": "UTC",
    "date": "2026-09-03T20:00:00+00:00",
    "timestamp": 1788465600,
    "periods": {
      "first": 1788465600,
      "second": null
    },
    "venue": {
      "id": 12,
      "name": "Stade Mustapha Tchaker",
      "city": "Blida"
    },
    "status": {
      "long": "First Half",
      "short": "1H",
      "elapsed": 15,
      "extra": null
    }
  },
  "league": {
    "id": 186,
    "name": "Ligue 1",
    "country": "Algeria",
    "logo": "https://media.api-sports.io/football/leagues/186.png",
    "flag": "https://media.api-sports.io/flags/dz.svg",
    "season": 2026,
    "round": "Regular Season - 1",
    "standings": true
  },
  "teams": {
    "home": {
      "id": 20699,
      "name": "JS El Biar",
      "logo": "https://media.api-sports.io/football/teams/20699.png",
      "winner": null
    },
    "away": {
      "id": 10780,
      "name": "Olympique Akbou",
      "logo": "https://media.api-sports.io/football/teams/10780.png",
      "winner": null
    }
  },
  "goals": {
    "home": 0,
    "away": 0
  },
  "score": {
    "halftime": {
      "home": 0,
      "away": 0
    },
    "fulltime": {
      "home": null,
      "away": null
    },
    "extratime": {
      "home": null,
      "away": null
    },
    "penalty": {
      "home": null,
      "away": null
    }
  },
  "events": []
};

export const primeiroTempoAcrescimo = {
  "fixture": {
    "id": 1636630,
    "referee": null,
    "timezone": "UTC",
    "date": "2026-09-03T19:30:00+00:00",
    "timestamp": 1788463800,
    "periods": {
      "first": 1788463800,
      "second": null
    },
    "venue": {
      "id": null,
      "name": null,
      "city": null
    },
    "status": {
      "long": "First Half",
      "short": "1H",
      "elapsed": 45,
      "extra": 3
    }
  },
  "league": {
    "id": 251,
    "name": "Division Intermedia",
    "country": "Paraguay",
    "logo": "https://media.api-sports.io/football/leagues/251.png",
    "flag": "https://media.api-sports.io/flags/py.svg",
    "season": 2026,
    "round": "Regular Season - 22",
    "standings": true
  },
  "teams": {
    "home": {
      "id": 1180,
      "name": "Deportivo Capiata",
      "logo": "https://media.api-sports.io/football/teams/1180.png",
      "winner": true
    },
    "away": {
      "id": 21374,
      "name": "3 de Noviembre",
      "logo": "https://media.api-sports.io/football/teams/21374.png",
      "winner": false
    }
  },
  "goals": {
    "home": 1,
    "away": 0
  },
  "score": {
    "halftime": {
      "home": 1,
      "away": 0
    },
    "fulltime": {
      "home": null,
      "away": null
    },
    "extratime": {
      "home": null,
      "away": null
    },
    "penalty": {
      "home": null,
      "away": null
    }
  },
  "events": [
    {
      "time": {
        "elapsed": 26,
        "extra": null
      },
      "team": {
        "id": 1180,
        "name": "Deportivo Capiata",
        "logo": "https://media.api-sports.io/football/teams/1180.png"
      },
      "player": {
        "id": 70567,
        "name": "J. Benitez"
      },
      "assist": {
        "id": null,
        "name": null
      },
      "type": "Goal",
      "detail": "Normal Goal",
      "comments": null
    }
  ]
};

export const segundoTempo = {
  "fixture": {
    "id": 1519479,
    "referee": "B. L. Salazar",
    "timezone": "UTC",
    "date": "2026-09-03T19:00:00+00:00",
    "timestamp": 1788462000,
    "periods": {
      "first": null,
      "second": null
    },
    "venue": {
      "id": null,
      "name": null,
      "city": "Quito"
    },
    "status": {
      "long": "Second Half",
      "short": "2H",
      "elapsed": 49,
      "extra": null
    }
  },
  "league": {
    "id": 242,
    "name": "Liga Pro",
    "country": "Ecuador",
    "logo": "https://media.api-sports.io/football/leagues/242.png",
    "flag": "https://media.api-sports.io/flags/ec.svg",
    "season": 2026,
    "round": "Regular Season - 28",
    "standings": true
  },
  "teams": {
    "home": {
      "id": 1157,
      "name": "Universidad Catolica",
      "logo": "https://media.api-sports.io/football/teams/1157.png",
      "winner": true
    },
    "away": {
      "id": 1156,
      "name": "Aucas",
      "logo": "https://media.api-sports.io/football/teams/1156.png",
      "winner": false
    }
  },
  "goals": {
    "home": 1,
    "away": 0
  },
  "score": {
    "halftime": {
      "home": 1,
      "away": 0
    },
    "fulltime": {
      "home": null,
      "away": null
    },
    "extratime": {
      "home": null,
      "away": null
    },
    "penalty": {
      "home": null,
      "away": null
    }
  },
  "events": [
    {
      "time": {
        "elapsed": 15,
        "extra": null
      },
      "team": {
        "id": 1156,
        "name": "Aucas",
        "logo": "https://media.api-sports.io/football/teams/1156.png"
      },
      "player": {
        "id": 374150,
        "name": "Mateo Burdisso"
      },
      "assist": {
        "id": null,
        "name": null
      },
      "type": "Card",
      "detail": "Yellow Card",
      "comments": "Foul"
    },
    {
      "time": {
        "elapsed": 33,
        "extra": null
      },
      "team": {
        "id": 1157,
        "name": "Universidad Catolica",
        "logo": "https://media.api-sports.io/football/teams/1157.png"
      },
      "player": {
        "id": 16405,
        "name": "Daniel Clavijo"
      },
      "assist": {
        "id": null,
        "name": null
      },
      "type": "Card",
      "detail": "Yellow Card",
      "comments": "Foul"
    },
    {
      "time": {
        "elapsed": 38,
        "extra": null
      },
      "team": {
        "id": 1157,
        "name": "Universidad Catolica",
        "logo": "https://media.api-sports.io/football/teams/1157.png"
      },
      "player": {
        "id": 16393,
        "name": "Facundo Martinez"
      },
      "assist": {
        "id": null,
        "name": null
      },
      "type": "Card",
      "detail": "Yellow Card",
      "comments": "Foul"
    },
    {
      "time": {
        "elapsed": 45,
        "extra": 1
      },
      "team": {
        "id": 1156,
        "name": "Aucas",
        "logo": "https://media.api-sports.io/football/teams/1156.png"
      },
      "player": {
        "id": 307843,
        "name": "Santiago Morales"
      },
      "assist": {
        "id": null,
        "name": null
      },
      "type": "Card",
      "detail": "Yellow Card",
      "comments": "Foul"
    },
    {
      "time": {
        "elapsed": 45,
        "extra": 5
      },
      "team": {
        "id": 1157,
        "name": "Universidad Catolica",
        "logo": "https://media.api-sports.io/football/teams/1157.png"
      },
      "player": {
        "id": 2983,
        "name": "José Fajardo"
      },
      "assist": {
        "id": null,
        "name": null
      },
      "type": "Var",
      "detail": "Penalty confirmed",
      "comments": null
    },
    {
      "time": {
        "elapsed": 45,
        "extra": 6
      },
      "team": {
        "id": 1157,
        "name": "Universidad Catolica",
        "logo": "https://media.api-sports.io/football/teams/1157.png"
      },
      "player": {
        "id": 2983,
        "name": "José Fajardo"
      },
      "assist": {
        "id": null,
        "name": null
      },
      "type": "Goal",
      "detail": "Penalty",
      "comments": null
    }
  ]
};

export const segundoTempoSaturado = {
  "fixture": {
    "id": 1555381,
    "referee": null,
    "timezone": "UTC",
    "date": "2026-09-03T18:30:00+00:00",
    "timestamp": 1788460200,
    "periods": {
      "first": null,
      "second": null
    },
    "venue": {
      "id": 1530,
      "name": "St. Jakob-Park",
      "city": "Basel"
    },
    "status": {
      "long": "Second Half",
      "short": "2H",
      "elapsed": 90,
      "extra": null
    }
  },
  "league": {
    "id": 207,
    "name": "Super League",
    "country": "Switzerland",
    "logo": "https://media.api-sports.io/football/leagues/207.png",
    "flag": "https://media.api-sports.io/flags/ch.svg",
    "season": 2026,
    "round": "Regular Season - 6",
    "standings": true
  },
  "teams": {
    "home": {
      "id": 551,
      "name": "FC Basel 1893",
      "logo": "https://media.api-sports.io/football/teams/551.png",
      "winner": false
    },
    "away": {
      "id": 630,
      "name": "FC Sion",
      "logo": "https://media.api-sports.io/football/teams/630.png",
      "winner": true
    }
  },
  "goals": {
    "home": 1,
    "away": 2
  },
  "score": {
    "halftime": {
      "home": 1,
      "away": 0
    },
    "fulltime": {
      "home": null,
      "away": null
    },
    "extratime": {
      "home": null,
      "away": null
    },
    "penalty": {
      "home": null,
      "away": null
    }
  },
  "events": [
    {
      "time": {
        "elapsed": 40,
        "extra": null
      },
      "team": {
        "id": 551,
        "name": "FC Basel 1893",
        "logo": "https://media.api-sports.io/football/teams/551.png"
      },
      "player": {
        "id": 788,
        "name": "Žan Celar"
      },
      "assist": {
        "id": 486294,
        "name": "Asane Sow"
      },
      "type": "Goal",
      "detail": "Normal Goal",
      "comments": null
    },
    {
      "time": {
        "elapsed": 45,
        "extra": null
      },
      "team": {
        "id": 630,
        "name": "FC Sion",
        "logo": "https://media.api-sports.io/football/teams/630.png"
      },
      "player": {
        "id": 48771,
        "name": "Ali Kabacalman"
      },
      "assist": {
        "id": null,
        "name": null
      },
      "type": "Card",
      "detail": "Yellow Card",
      "comments": "Dissent"
    },
    {
      "time": {
        "elapsed": 45,
        "extra": 2
      },
      "team": {
        "id": 551,
        "name": "FC Basel 1893",
        "logo": "https://media.api-sports.io/football/teams/551.png"
      },
      "player": {
        "id": 788,
        "name": "Žan Celar"
      },
      "assist": {
        "id": null,
        "name": null
      },
      "type": "Var",
      "detail": "Goal cancelled",
      "comments": null
    },
    {
      "time": {
        "elapsed": 60,
        "extra": null
      },
      "team": {
        "id": 551,
        "name": "FC Basel 1893",
        "logo": "https://media.api-sports.io/football/teams/551.png"
      },
      "player": {
        "id": 307,
        "name": "Xherdan Shaqiri"
      },
      "assist": {
        "id": 338950,
        "name": "Ludwig Thorell"
      },
      "type": "subst",
      "detail": "Substitution 1",
      "comments": null
    },
    {
      "time": {
        "elapsed": 60,
        "extra": null
      },
      "team": {
        "id": 551,
        "name": "FC Basel 1893",
        "logo": "https://media.api-sports.io/football/teams/551.png"
      },
      "player": {
        "id": 167659,
        "name": "Kazeem Olaigbe"
      },
      "assist": {
        "id": 73879,
        "name": "Philip Otele"
      },
      "type": "subst",
      "detail": "Substitution 2",
      "comments": null
    },
    {
      "time": {
        "elapsed": 61,
        "extra": null
      },
      "team": {
        "id": 551,
        "name": "FC Basel 1893",
        "logo": "https://media.api-sports.io/football/teams/551.png"
      },
      "player": {
        "id": 328464,
        "name": "Moussa Cisse"
      },
      "assist": {
        "id": null,
        "name": null
      },
      "type": "Card",
      "detail": "Yellow Card",
      "comments": "Foul"
    },
    {
      "time": {
        "elapsed": 66,
        "extra": null
      },
      "team": {
        "id": 630,
        "name": "FC Sion",
        "logo": "https://media.api-sports.io/football/teams/630.png"
      },
      "player": {
        "id": 300871,
        "name": "Théo Berdayes"
      },
      "assist": {
        "id": 278018,
        "name": "Franck Surdez"
      },
      "type": "subst",
      "detail": "Substitution 1",
      "comments": null
    },
    {
      "time": {
        "elapsed": 66,
        "extra": null
      },
      "team": {
        "id": 630,
        "name": "FC Sion",
        "logo": "https://media.api-sports.io/football/teams/630.png"
      },
      "player": {
        "id": 136741,
        "name": "Donat Rrudhani"
      },
      "assist": {
        "id": 135264,
        "name": "Josias Lukembila"
      },
      "type": "subst",
      "detail": "Substitution 2",
      "comments": null
    },
    {
      "time": {
        "elapsed": 67,
        "extra": null
      },
      "team": {
        "id": 630,
        "name": "FC Sion",
        "logo": "https://media.api-sports.io/football/teams/630.png"
      },
      "player": {
        "id": 395811,
        "name": "Fodé Sylla"
      },
      "assist": {
        "id": 119180,
        "name": "Rilind Nivokazi"
      },
      "type": "subst",
      "detail": "Substitution 3",
      "comments": null
    },
    {
      "time": {
        "elapsed": 76,
        "extra": null
      },
      "team": {
        "id": 630,
        "name": "FC Sion",
        "logo": "https://media.api-sports.io/football/teams/630.png"
      },
      "player": {
        "id": 394180,
        "name": "Winsley Boteli Mokango"
      },
      "assist": {
        "id": 135264,
        "name": "Josias Lukembila"
      },
      "type": "Goal",
      "detail": "Normal Goal",
      "comments": null
    },
    {
      "time": {
        "elapsed": 79,
        "extra": null
      },
      "team": {
        "id": 551,
        "name": "FC Basel 1893",
        "logo": "https://media.api-sports.io/football/teams/551.png"
      },
      "player": {
        "id": 338950,
        "name": "Ludwig Thorell"
      },
      "assist": {
        "id": null,
        "name": null
      },
      "type": "Card",
      "detail": "Yellow Card",
      "comments": "Foul"
    },
    {
      "time": {
        "elapsed": 79,
        "extra": null
      },
      "team": {
        "id": 630,
        "name": "FC Sion",
        "logo": "https://media.api-sports.io/football/teams/630.png"
      },
      "player": {
        "id": 394180,
        "name": "Winsley Boteli Mokango"
      },
      "assist": {
        "id": null,
        "name": null
      },
      "type": "Goal",
      "detail": "Normal Goal",
      "comments": null
    },
    {
      "time": {
        "elapsed": 84,
        "extra": null
      },
      "team": {
        "id": 630,
        "name": "FC Sion",
        "logo": "https://media.api-sports.io/football/teams/630.png"
      },
      "player": {
        "id": 394180,
        "name": "Winsley Boteli Mokango"
      },
      "assist": {
        "id": 323746,
        "name": "Liam Chipperfield"
      },
      "type": "subst",
      "detail": "Substitution 4",
      "comments": null
    },
    {
      "time": {
        "elapsed": 85,
        "extra": null
      },
      "team": {
        "id": 630,
        "name": "FC Sion",
        "logo": "https://media.api-sports.io/football/teams/630.png"
      },
      "player": {
        "id": 134301,
        "name": "Noé Sow"
      },
      "assist": {
        "id": null,
        "name": null
      },
      "type": "Card",
      "detail": "Yellow Card",
      "comments": "Foul"
    },
    {
      "time": {
        "elapsed": 89,
        "extra": null
      },
      "team": {
        "id": 551,
        "name": "FC Basel 1893",
        "logo": "https://media.api-sports.io/football/teams/551.png"
      },
      "player": {
        "id": 788,
        "name": "Žan Celar"
      },
      "assist": {
        "id": 561885,
        "name": "giacomo koloto"
      },
      "type": "subst",
      "detail": "Substitution 3",
      "comments": null
    },
    {
      "time": {
        "elapsed": 89,
        "extra": null
      },
      "team": {
        "id": 551,
        "name": "FC Basel 1893",
        "logo": "https://media.api-sports.io/football/teams/551.png"
      },
      "player": {
        "id": 305816,
        "name": "Abemly Meto Silu Metinho"
      },
      "assist": {
        "id": 403633,
        "name": "Jonas harder"
      },
      "type": "subst",
      "detail": "Substitution 4",
      "comments": null
    },
    {
      "time": {
        "elapsed": 89,
        "extra": null
      },
      "team": {
        "id": 551,
        "name": "FC Basel 1893",
        "logo": "https://media.api-sports.io/football/teams/551.png"
      },
      "player": {
        "id": 999,
        "name": "Becir Omeragic"
      },
      "assist": {
        "id": 48606,
        "name": "Nicolas·Vouilloz"
      },
      "type": "subst",
      "detail": "Substitution 5",
      "comments": null
    }
  ]
};

export const envelopeVazio = {
  "get": "fixtures",
  "parameters": {
    "live": "all"
  },
  "errors": [],
  "results": 0,
  "paging": {
    "current": 1,
    "total": 1
  },
  "response": []
};

/**
 * Recortes VERBATIM de `agenda-sample.json` (GET /fixtures?date=2026-09-04,
 * 454 partidas do dia, 209 ligas, capturado em 2026-09-04). Mesmo criterio do
 * bloco acima: copiados sem edicao, e o arquivo de 440 KB nao e versionado.
 *
 * SHAPE IDENTICO ao de `live=all`, MEDIDO: a uniao dos caminhos de campo das
 * 454 partidas e igual a das 89 de `live-pico.json`, com uma unica diferenca
 * — `events` existe nas 89 ao vivo e em nenhuma das 454 da agenda. O
 * adaptador nunca le `events`, entao `toFixture` serve os dois endpoints.
 *
 * Seis recortes, um por status presente na captura: NS (237 ocorrencias no
 * arquivo), FT (108), PST (19), PEN (1), 1H (43) e HT (10). Os quatro
 * primeiros sao status que `live-sample.json` nao tinha.
 *
 * ATENCAO ao usar `agenda1H` e `agendaHT` como evidencia: vieram do endpoint
 * `date=`, nao do `live=all`. Para o caminho AO VIVO — o que dispara alerta
 * de gol — a evidencia forte esta em `picoPrimeiroTempo`, `picoSegundoTempo`
 * e `picoIntervalo`, no fim do arquivo.
 *
 * Tambem trazem o caso de `goals` nulo (256 das 454 partidas), que ate aqui
 * era so tratamento defensivo sem observacao nenhuma por tras.
 */

export const agendaNS = {
  "fixture": {
    "id": 1601128,
    "referee": null,
    "timezone": "UTC",
    "date": "2026-09-04T12:15:00+00:00",
    "timestamp": 1788524100,
    "periods": {
      "first": null,
      "second": null
    },
    "venue": {
      "id": null,
      "name": "Sultan Hassanal Bolkiah Stadium",
      "city": "B. S. Begawan"
    },
    "status": {
      "long": "Not Started",
      "short": "NS",
      "elapsed": null,
      "extra": null
    }
  },
  "league": {
    "id": 278,
    "name": "Super League",
    "country": "Malaysia",
    "logo": "https://media.api-sports.io/football/leagues/278.png",
    "flag": "https://media.api-sports.io/flags/my.svg",
    "season": 2026,
    "round": "Regular Season - 3",
    "standings": true
  },
  "teams": {
    "home": {
      "id": 4202,
      "name": "DPMM FC Brunei",
      "logo": "https://media.api-sports.io/football/teams/4202.png",
      "winner": null
    },
    "away": {
      "id": 2523,
      "name": "Johor Darul Takzim FC",
      "logo": "https://media.api-sports.io/football/teams/2523.png",
      "winner": null
    }
  },
  "goals": {
    "home": null,
    "away": null
  },
  "score": {
    "halftime": {
      "home": null,
      "away": null
    },
    "fulltime": {
      "home": null,
      "away": null
    },
    "extratime": {
      "home": null,
      "away": null
    },
    "penalty": {
      "home": null,
      "away": null
    }
  }
};

export const agendaFT = {
  "fixture": {
    "id": 1519477,
    "referee": "L. Quinonez",
    "timezone": "UTC",
    "date": "2026-09-04T00:00:00+00:00",
    "timestamp": 1788480000,
    "periods": {
      "first": null,
      "second": null
    },
    "venue": {
      "id": 472,
      "name": "Estadio Federativo Reina del Cisne",
      "city": "Loja"
    },
    "status": {
      "long": "Match Finished",
      "short": "FT",
      "elapsed": 90,
      "extra": null
    }
  },
  "league": {
    "id": 242,
    "name": "Liga Pro",
    "country": "Ecuador",
    "logo": "https://media.api-sports.io/football/leagues/242.png",
    "flag": "https://media.api-sports.io/flags/ec.svg",
    "season": 2026,
    "round": "Regular Season - 28",
    "standings": true
  },
  "teams": {
    "home": {
      "id": 18762,
      "name": "Libertad",
      "logo": "https://media.api-sports.io/football/teams/18762.png",
      "winner": null
    },
    "away": {
      "id": 1148,
      "name": "Emelec",
      "logo": "https://media.api-sports.io/football/teams/1148.png",
      "winner": null
    }
  },
  "goals": {
    "home": 1,
    "away": 1
  },
  "score": {
    "halftime": {
      "home": 1,
      "away": 0
    },
    "fulltime": {
      "home": 1,
      "away": 1
    },
    "extratime": {
      "home": null,
      "away": null
    },
    "penalty": {
      "home": null,
      "away": null
    }
  }
};

export const agendaPST = {
  "fixture": {
    "id": 1629069,
    "referee": null,
    "timezone": "UTC",
    "date": "2026-09-04T12:00:00+00:00",
    "timestamp": 1788523200,
    "periods": {
      "first": null,
      "second": null
    },
    "venue": {
      "id": null,
      "name": null,
      "city": null
    },
    "status": {
      "long": "Match Postponed",
      "short": "PST",
      "elapsed": null,
      "extra": null
    }
  },
  "league": {
    "id": 276,
    "name": "FKF Premier League",
    "country": "Kenya",
    "logo": "https://media.api-sports.io/football/leagues/276.png",
    "flag": "https://media.api-sports.io/flags/ke.svg",
    "season": 2026,
    "round": "Regular Season - 2",
    "standings": true
  },
  "teams": {
    "home": {
      "id": 19476,
      "name": "APS Bomet",
      "logo": "https://media.api-sports.io/football/teams/19476.png",
      "winner": null
    },
    "away": {
      "id": 2467,
      "name": "GOR Mahia",
      "logo": "https://media.api-sports.io/football/teams/2467.png",
      "winner": null
    }
  },
  "goals": {
    "home": null,
    "away": null
  },
  "score": {
    "halftime": {
      "home": null,
      "away": null
    },
    "fulltime": {
      "home": null,
      "away": null
    },
    "extratime": {
      "home": null,
      "away": null
    },
    "penalty": {
      "home": null,
      "away": null
    }
  }
};

export const agendaPEN = {
  "fixture": {
    "id": 1592833,
    "referee": null,
    "timezone": "UTC",
    "date": "2026-09-04T15:00:00+00:00",
    "timestamp": 1788534000,
    "periods": {
      "first": 1788534000,
      "second": 1788537600
    },
    "venue": {
      "id": null,
      "name": null,
      "city": null
    },
    "status": {
      "long": "Match Finished",
      "short": "PEN",
      "elapsed": 120,
      "extra": null
    }
  },
  "league": {
    "id": 1200,
    "name": "Liga MX U21",
    "country": "Mexico",
    "logo": "https://media.api-sports.io/football/leagues/1200.png",
    "flag": "https://media.api-sports.io/flags/mx.svg",
    "season": 2026,
    "round": "Regular Season - 7",
    "standings": true
  },
  "teams": {
    "home": {
      "id": 26834,
      "name": "Juarez U21",
      "logo": "https://media.api-sports.io/football/teams/26834.png",
      "winner": false
    },
    "away": {
      "id": 26838,
      "name": "Pachuca U21",
      "logo": "https://media.api-sports.io/football/teams/26838.png",
      "winner": true
    }
  },
  "goals": {
    "home": 1,
    "away": 1
  },
  "score": {
    "halftime": {
      "home": 1,
      "away": 1
    },
    "fulltime": {
      "home": 1,
      "away": 1
    },
    "extratime": {
      "home": 0,
      "away": 0
    },
    "penalty": {
      "home": 7,
      "away": 8
    }
  }
};

export const agenda1H = {
  "fixture": {
    "id": 1595140,
    "referee": null,
    "timezone": "UTC",
    "date": "2026-09-04T13:30:00+00:00",
    "timestamp": 1788528600,
    "periods": {
      "first": 1788528600,
      "second": null
    },
    "venue": {
      "id": 8544,
      "name": "El Mahalla Stadium",
      "city": "El Mahalla El Kubra"
    },
    "status": {
      "long": "First Half",
      "short": "1H",
      "elapsed": 24,
      "extra": null
    }
  },
  "league": {
    "id": 887,
    "name": "Second League",
    "country": "Egypt",
    "logo": "https://media.api-sports.io/football/leagues/887.png",
    "flag": "https://media.api-sports.io/flags/eg.svg",
    "season": 2026,
    "round": "Regular Season - 3",
    "standings": true
  },
  "teams": {
    "home": {
      "id": 18036,
      "name": "Baladiyyat Al Mehalla",
      "logo": "https://media.api-sports.io/football/teams/18036.png",
      "winner": null
    },
    "away": {
      "id": 28011,
      "name": "Mega Sport",
      "logo": "https://media.api-sports.io/football/teams/28011.png",
      "winner": null
    }
  },
  "goals": {
    "home": 0,
    "away": 0
  },
  "score": {
    "halftime": {
      "home": 0,
      "away": 0
    },
    "fulltime": {
      "home": null,
      "away": null
    },
    "extratime": {
      "home": null,
      "away": null
    },
    "penalty": {
      "home": null,
      "away": null
    }
  }
};

export const agendaHT = {
  "fixture": {
    "id": 1551450,
    "referee": null,
    "timezone": "UTC",
    "date": "2026-09-04T16:30:00+00:00",
    "timestamp": 1788539400,
    "periods": {
      "first": 1788539400,
      "second": null
    },
    "venue": {
      "id": null,
      "name": "City Stadium Shtip",
      "city": null
    },
    "status": {
      "long": "Halftime",
      "short": "HT",
      "elapsed": 45,
      "extra": 5
    }
  },
  "league": {
    "id": 371,
    "name": "First League",
    "country": "Macedonia",
    "logo": "https://media.api-sports.io/football/leagues/371.png",
    "flag": "https://media.api-sports.io/flags/mk.svg",
    "season": 2026,
    "round": "Regular Season - 6",
    "standings": true
  },
  "teams": {
    "home": {
      "id": 4333,
      "name": "Bregalnica Štip",
      "logo": "https://media.api-sports.io/football/teams/4333.png",
      "winner": null
    },
    "away": {
      "id": 24781,
      "name": "Shkëndija Haraçinë",
      "logo": "https://media.api-sports.io/football/teams/24781.png",
      "winner": null
    }
  },
  "goals": {
    "home": 0,
    "away": 0
  },
  "score": {
    "halftime": {
      "home": 0,
      "away": 0
    },
    "fulltime": {
      "home": null,
      "away": null
    },
    "extratime": {
      "home": null,
      "away": null
    },
    "penalty": {
      "home": null,
      "away": null
    }
  }
};

/** Envelope da agenda, verbatim (sem o array `response`, que cada teste monta). */
export const envelopeAgendaVazio = {
  "get": "fixtures",
  "parameters": {
    "date": "2026-09-04"
  },
  "errors": [],
  "results": 0,
  "paging": {
    "current": 1,
    "total": 1
  },
  "response": []
};

/**
 * Recortes VERBATIM de `live-pico.json` (GET /fixtures?live=all em horario de
 * pico, 89 partidas ao vivo em 63 ligas, capturado em 2026-09-04). Copiados
 * sem edicao; o arquivo de 167 KB nao e versionado.
 *
 * ESTA e a evidencia forte do caminho AO VIVO — o que alimenta o diff e
 * dispara alerta de gol. A distribuicao de status no arquivo foi 43 `1H`,
 * 36 `2H` e 10 `HT`; `HT` nao aparecia em captura de `live=all` nenhuma
 * antes desta.
 *
 * Escolhidos por serem os MENORES de cada status, para nao inchar o helper:
 * os tres tem `events: []`. A chave `events` estar presente e vazia, e nao
 * ausente, e o que sustenta a unica diferenca de shape medida entre
 * `live=all` e `date=`.
 *
 * `picoIntervalo` traz `elapsed: 45` com `extra: 1`: no intervalo a API
 * mantem o minuto saturado e o acrescimo no campo separado, igual ao que
 * `live-sample.json` mostrou no primeiro tempo.
 */

export const picoIntervalo = {
  "fixture": {
    "id": 1607218,
    "referee": null,
    "timezone": "UTC",
    "date": "2026-09-04T16:30:00+00:00",
    "timestamp": 1788539400,
    "periods": {
      "first": 1788539400,
      "second": null
    },
    "venue": {
      "id": null,
      "name": "Alpenstadion",
      "city": "Kapfenberg"
    },
    "status": {
      "long": "Halftime",
      "short": "HT",
      "elapsed": 45,
      "extra": 1
    }
  },
  "league": {
    "id": 220,
    "name": "Cup",
    "country": "Austria",
    "logo": "https://media.api-sports.io/football/leagues/220.png",
    "flag": "https://media.api-sports.io/flags/at.svg",
    "season": 2026,
    "round": "Round of 32",
    "standings": false
  },
  "teams": {
    "home": {
      "id": 1401,
      "name": "SV Kapfenberg",
      "logo": "https://media.api-sports.io/football/teams/1401.png",
      "winner": null
    },
    "away": {
      "id": 22213,
      "name": "WSPG Wels",
      "logo": "https://media.api-sports.io/football/teams/22213.png",
      "winner": null
    }
  },
  "goals": {
    "home": 0,
    "away": 0
  },
  "score": {
    "halftime": {
      "home": 0,
      "away": 0
    },
    "fulltime": {
      "home": null,
      "away": null
    },
    "extratime": {
      "home": null,
      "away": null
    },
    "penalty": {
      "home": null,
      "away": null
    }
  },
  "events": []
};

export const picoPrimeiroTempo = {
  "fixture": {
    "id": 1620128,
    "referee": null,
    "timezone": "UTC",
    "date": "2026-09-04T17:00:00+00:00",
    "timestamp": 1788541200,
    "periods": {
      "first": 1788541200,
      "second": null
    },
    "venue": {
      "id": null,
      "name": null,
      "city": null
    },
    "status": {
      "long": "First Half",
      "short": "1H",
      "elapsed": 28,
      "extra": null
    }
  },
  "league": {
    "id": 20,
    "name": "CAF Confederation Cup",
    "country": "World",
    "logo": "https://media.api-sports.io/football/leagues/20.png",
    "flag": null,
    "season": 2026,
    "round": "1st Preliminary Round",
    "standings": false
  },
  "teams": {
    "home": {
      "id": 15595,
      "name": "Al Hilal Port Sudan",
      "logo": "https://media.api-sports.io/football/teams/15595.png",
      "winner": null
    },
    "away": {
      "id": 4125,
      "name": "Welwalo Adigrat Uni",
      "logo": "https://media.api-sports.io/football/teams/4125.png",
      "winner": null
    }
  },
  "goals": {
    "home": 0,
    "away": 0
  },
  "score": {
    "halftime": {
      "home": 0,
      "away": 0
    },
    "fulltime": {
      "home": null,
      "away": null
    },
    "extratime": {
      "home": null,
      "away": null
    },
    "penalty": {
      "home": null,
      "away": null
    }
  },
  "events": []
};

export const picoSegundoTempo = {
  "fixture": {
    "id": 1556439,
    "referee": null,
    "timezone": "UTC",
    "date": "2026-09-04T16:00:00+00:00",
    "timestamp": 1788537600,
    "periods": {
      "first": 1788537600,
      "second": 1788541200
    },
    "venue": {
      "id": null,
      "name": null,
      "city": null
    },
    "status": {
      "long": "Second Half",
      "short": "2H",
      "elapsed": 70,
      "extra": null
    }
  },
  "league": {
    "id": 361,
    "name": "1 Lyga",
    "country": "Lithuania",
    "logo": "https://media.api-sports.io/football/leagues/361.png",
    "flag": "https://media.api-sports.io/flags/lt.svg",
    "season": 2026,
    "round": "Regular Season - 23",
    "standings": true
  },
  "teams": {
    "home": {
      "id": 3862,
      "name": "Jonava",
      "logo": "https://media.api-sports.io/football/teams/3862.png",
      "winner": null
    },
    "away": {
      "id": 3859,
      "name": "Dainava",
      "logo": "https://media.api-sports.io/football/teams/3859.png",
      "winner": null
    }
  },
  "goals": {
    "home": 0,
    "away": 0
  },
  "score": {
    "halftime": {
      "home": 0,
      "away": 0
    },
    "fulltime": {
      "home": null,
      "away": null
    },
    "extratime": {
      "home": null,
      "away": null
    },
    "penalty": {
      "home": null,
      "away": null
    }
  },
  "events": []
};
