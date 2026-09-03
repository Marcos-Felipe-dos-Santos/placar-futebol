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
