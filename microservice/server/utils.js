function filterProducts(products, { category, search } = {}) {
  let result = [...products];

  if (category && category !== 'all') {
    result = result.filter(
      (p) => p.category.toLowerCase() === category.toLowerCase()
    );
  }

  if (search) {
    const term = search.toLowerCase();
    result = result.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.description.toLowerCase().includes(term)
    );
  }

  return result;
}

module.exports = { filterProducts };
