// Tesseract language codes. Kept separate so the UI doesn't pull the OCR engine into the startup bundle.
export const OCR_LANGS: Record<string, string> = {
  auto: 'Auto-detect',
  eng: 'English', deu: 'German', fra: 'French', spa: 'Spanish', ita: 'Italian', por: 'Portuguese',
  nld: 'Dutch', pol: 'Polish', tur: 'Turkish', rus: 'Russian', ara: 'Arabic', chi_sim: 'Chinese (Simplified)',
  jpn: 'Japanese', kor: 'Korean', hin: 'Hindi', yor: 'Yoruba', hau: 'Hausa', ibo: 'Igbo', swa: 'Swahili',
};
