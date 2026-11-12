/**
 * Relações carregadas para montar as respostas do agendamento. Só nomes e o
 * id do perfil do avaliador: nenhuma resposta traz id de usuário.
 */
export const APPOINTMENT_INCLUDE = {
  listing: { select: { id: true, title: true, city: true, state: true } },
  buyer: { select: { name: true } },
  seller: { select: { name: true } },
  inspector: { select: { name: true, inspectorProfile: { select: { id: true } } } },
} as const;
