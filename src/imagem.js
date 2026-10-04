// Reduz a foto escolhida (máx. `max` px no maior lado, JPEG) antes de guardar: fica leve para salvar
// no banco e sai nítida nos PDFs. Devolve uma "data URL" (texto) pronta para guardar e mostrar.
export function reduzirImagem(arquivo, max = 900, qualidade = 0.78) {
  return new Promise((resolve, reject) => {
    if (!arquivo || !/^image\//.test(arquivo.type)) return reject(new Error('Escolha um arquivo de imagem (JPG, PNG ou WEBP).'));
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * escala));
      const h = Math.max(1, Math.round(img.height * escala));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // PNG com fundo transparente fica branco
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', qualidade));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler esta imagem.')); };
    img.src = url;
  });
}

// Foto do produto: a versão normal (900px) e uma miniatura (120px) para a lista do estoque ficar leve.
export async function fotoDoProduto(arquivo) {
  const imagem = await reduzirImagem(arquivo, 900, 0.78);
  const imagem_mini = await reduzirImagem(arquivo, 120, 0.7);
  return { imagem, imagem_mini };
}
