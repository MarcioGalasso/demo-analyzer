const fs = require("fs");
const { DemoReader, EntityMode } = require("cs2parser");

// Coloque o nome correto do seu arquivo .dem aqui
const demoPath = "analise.dem"; 

async function analisarDemo() {
  console.log("Iniciando a leitura da demo do CS2... Aguarde.");
  
  const parser = new DemoReader();
  let relatorioMortes = [];

  // Escuta os eventos de morte (player_death) nativos do CS2
  parser.gameEvents.on("player_death", (event) => {
    const attacker = event.attackerPlayer;
    const victim = event.player;

    if (attacker && victim) {
      relatorioMortes.push({
        round: parser.gameRules?.roundsPlayed ? parser.gameRules.roundsPlayed + 1 : "Desconhecido",
        assassino: attacker.name,
        time_assassino: attacker.teamNumber === 2 ? "TR" : "CT",
        vitima: victim.name,
        time_vitima: victim.teamNumber === 2 ? "TR" : "CT",
        arma: event.weapon,
        headshot: event.isHeadshot ? "Sim" : "Não"
      });
    }
  });

  try {
    // Processa o arquivo binário da demo
    await parser.parseDemo(demoPath, { entities: EntityMode.ALL });
    
    // Salva em formato JSON para a IA ler perfeitamente dentro do Cursor
    fs.writeFileSync("dados_partida.json", JSON.stringify(relatorioMortes, null, 2));
    console.log("Análise concluída com sucesso! Arquivo dados_partida.json gerado.");
  } catch (error) {
    console.error("Erro ao ler o arquivo da demo:", error);
  }
}

analisarDemo();
