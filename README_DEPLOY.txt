Easyspearfishing 2.17 - Estatísticas

Esta versão mantém a V2.16 e acrescenta /stats.html e /api/stats.

IMPORTANTE SOBRE DADOS: Render sem Persistent Disk não garante persistência de ficheiros locais entre reinícios/deploys. Para manter observações e estatísticas de forma persistente, configure no Render um Persistent Disk montado, por exemplo em /var/data. Depois defina a variável DATA_DIR=/var/data.

Se não tiver Persistent Disk, os dados podem ser perdidos num restart/deploy. O código não apaga o ficheiro se ele já existir no volume.
