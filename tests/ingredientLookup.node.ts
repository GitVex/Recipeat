import assert from 'node:assert/strict'
import { test } from 'node:test'
import { densityFrom, densityIn, labelsOf, wikidataNames } from '../server/ingredients/lookup.ts'

// Names and density for a new ingredient entry (#174): what is read out of a
// search snippet and out of Wikidata's answer.

test('a figure in g/ml, in its usual spellings', () => {
  assert.equal(densityIn('Pasta tagliatelle. Density: 0.32 g/mL. Allergens.'), 0.32)
  assert.equal(densityIn('Sauce Density = ~1.05 g/mL (typical for Bolognese).'), 1.05)
  assert.equal(densityIn('Dichte: 1,03 g/ml bei 20 °C'), 1.03)
  assert.equal(densityIn('olive oil 0.92 g/cm³ at room temperature'), 0.92)
  assert.equal(densityIn('about 0.91 grams per milliliter'), 0.91)
  assert.equal(densityIn('honey weighs 1.42 kg/L'), 1.42)
})

test('a figure in grams per cup, either way round', () => {
  assert.equal(densityIn('All-purpose flour: 125 g per cup'), 0.528)
  assert.equal(densityIn('there are 200 grams in a cup of sugar'), 0.845)
  assert.equal(densityIn('1 cup of rice = 185 g'), 0.782)
  assert.equal(densityIn('One US cup weighs 240 grams'), 1.014)
})

test('nothing that only looks like one', () => {
  assert.equal(densityIn('Energy density: 172 kcal/100 g (medium)'), null)
  assert.equal(densityIn('Serve 100 g pasta with 50 ml sauce'), null)
  assert.equal(densityIn('1 cup (240 ml) of stock'), null)
  assert.equal(densityIn('A cup of tea'), null)
})

test('only a believable density, 0.1 to 2.5 g/ml; the first that is', () => {
  assert.equal(densityIn('7.9 g/cm³ for iron'), null)
  assert.equal(densityIn('0.05 g/ml when puffed'), null)
  assert.equal(densityIn('steel 7.8 g/cm3, water 1 g/ml'), 1)
  assert.equal(densityIn('water 1 g/ml, flour 125 g per cup'), 1)
})

test('the first result with a figure gives it, with its address', () => {
  const result = (url: string, snippet: string) => ({ title: 'Nutmeg', url, site: new URL(url).host, snippet })
  assert.deepEqual(densityFrom([
    result('https://a.com/x', 'Nutmeg is a spice.'),
    result('https://b.com/y', 'Ground nutmeg: 0.47 g/ml.'),
    result('https://c.com/z', 'Density 0.5 g/ml'),
  ]), { value: 0.47, url: 'https://b.com/y' })
  assert.equal(densityFrom([result('https://a.com/x', 'Nothing here.')]), null)
})

const entity = {
  entities: {
    Q83165: {
      labels: {
        en: { language: 'en', value: 'nutmeg' },
        'en-gb': { language: 'en-gb', value: 'nutmeg (GB)' },
        de: { language: 'de', value: 'Muskatnuss' },
        mul: { language: 'mul', value: 'Myristica fragrans' },
        'zh-hans': { language: 'zh-hans', value: '肉豆蔻' },
        'be-tarask': { language: 'be-tarask', value: 'мушкатовы арэх' },
        fr: { language: 'fr', value: '  ' },
      },
    },
  },
}

test("an item's labels, one per language by primary subtag", () => {
  assert.deepEqual(labelsOf(entity, 'Q83165'), [
    { lang: 'en', name: 'nutmeg' },
    { lang: 'de', name: 'Muskatnuss' },
    { lang: 'zh', name: '肉豆蔻' },
    { lang: 'be', name: 'мушкатовы арэх' },
  ])
  assert.deepEqual(labelsOf({}, 'Q1'), [])
  assert.deepEqual(labelsOf(null, 'Q1'), [])
})

test('Wikidata is searched in the name\'s language, then the first item read', async () => {
  const asked: URL[] = []
  const fetcher = (async (url: URL) => {
    asked.push(url)
    const body = url.searchParams.get('action') === 'wbsearchentities' ? { search: [{ id: 'Q83165' }] } : entity
    return new Response(JSON.stringify(body))
  }) as typeof fetch
  const names = await wikidataNames('Muskatnuss', 'de', fetcher)
  assert.equal(names.length, 4)
  assert.equal(asked[0]!.searchParams.get('search'), 'Muskatnuss')
  assert.equal(asked[0]!.searchParams.get('language'), 'de')
  assert.equal(asked[1]!.searchParams.get('ids'), 'Q83165')

  const nothing = (async () => new Response(JSON.stringify({ search: [] }))) as typeof fetch
  assert.deepEqual(await wikidataNames('ground beaf', 'en', nothing), [])
  const down = (async () => new Response('', { status: 503 })) as typeof fetch
  await assert.rejects(() => wikidataNames('nutmeg', 'en', down), /503/)
})
