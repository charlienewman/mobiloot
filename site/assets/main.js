// mobiloot.com — progressive enhancement only; the page reads fine without it.
;(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const $ = (s, r = document) => r.querySelector(s)
  const $$ = (s, r = document) => [...r.querySelectorAll(s)]

  // Nav background once the page has scrolled.
  const nav = $('#nav')
  const onNav = () => nav && nav.classList.toggle('scrolled', scrollY > 12)

  // Reveal on scroll.
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in')
          io.unobserve(e.target)
        }
      }),
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  )
  $$('.reveal').forEach((el) => io.observe(el))

  // Manifesto: words light up as the paragraph crosses the viewport.
  const manifesto = $('#manifesto')
  let words = []
  if (manifesto) {
    manifesto.innerHTML = manifesto.textContent
      .trim()
      .split(/\s+/)
      .map((w) => `<span class="w">${w}</span>`)
      .join(' ')
    words = $$('.w', manifesto)
  }
  const onManifesto = () => {
    if (!manifesto) return
    const r = manifesto.getBoundingClientRect()
    const p = (innerHeight * 0.82 - r.top) / (r.height + innerHeight * 0.35)
    const lit = Math.round(Math.min(1, Math.max(0, p)) * words.length)
    words.forEach((w, i) => w.classList.toggle('on', i < lit))
  }

  // Hero phone drifts up slightly slower than the page.
  const heroPhone = $('#heroPhone')
  const onHero = () => {
    if (!heroPhone || reduce || scrollY > innerHeight * 1.5) return
    heroPhone.style.transform = `translateY(${scrollY * -0.06}px)`
  }

  // How it works: the sticky phone follows the step nearest the middle of the screen.
  const steps = $$('.step')
  const shots = $$('.how-visual img')
  const onSteps = () => {
    if (!steps.length) return
    const mid = innerHeight / 2
    let best = steps[0]
    let dist = Infinity
    for (const s of steps) {
      const r = s.getBoundingClientRect()
      const d = Math.abs(r.top + r.height / 2 - mid)
      if (d < dist) {
        dist = d
        best = s
      }
    }
    steps.forEach((s) => s.classList.toggle('on', s === best))
    shots.forEach((i) => i.classList.toggle('on', i.dataset.screen === best.dataset.screen))
  }

  let ticking = false
  const onScroll = () => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      onNav()
      onManifesto()
      onHero()
      onSteps()
      ticking = false
    })
  }
  addEventListener('scroll', onScroll, { passive: true })
  addEventListener('resize', onScroll)
  onScroll()

  // Calculator.
  const slider = $('#stake')
  if (slider) {
    const APY = 0.068 // reference staking rate, as used in docs/economics.md
    const model = { solGbp: 60, planGbp: 10, live: false }
    const gbp = (n) => (n < 0.005 ? '£0' : '£' + n.toFixed(2))
    const C = 2 * Math.PI * 88
    const render = () => {
      const sol = Number(slider.value)
      const monthly = (sol * model.solGbp * APY) / 12
      const cover = monthly / model.planGbp
      const pct = Math.round(cover * 100)
      const full = (model.planGbp * 12) / (APY * model.solGbp)
      slider.style.setProperty('--fill', (sol / slider.max) * 100 + '%')
      $('#stakeOut').textContent = sol % 1 ? sol.toFixed(1) : sol
      $('#stakeFiat').textContent = `about £${Math.round(sol * model.solGbp).toLocaleString('en-GB')} at today's price`
      $('#rYield').textContent = gbp(monthly)
      $('#rPay').textContent = cover >= 1 ? '£0' : gbp(model.planGbp - monthly)
      $('#rFull').textContent = `${full.toFixed(1)} SOL`
      $('#pct').textContent = pct + '%'
      $('#ringBar').style.strokeDashoffset = C * (1 - Math.min(1, cover))
      $('#verdict').textContent =
        cover >= 1
          ? 'Your plan is free. Your rewards cover all of it.'
          : sol === 0
            ? 'Stake some SOL to see what it covers.'
            : `Your rewards pay ${gbp(Math.min(monthly, model.planGbp))} of your £${model.planGbp} plan.`
    }
    slider.addEventListener('input', render)
    render()
    // Live SOL price from the Mobiloot API (it reads Pyth). Falls back silently.
    fetch('https://api-production-e094.up.railway.app/v1/config')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((c) => {
        const usd = Number(c?.solUsd?.usd)
        const fx = Number(c?.gbpUsd)
        if (!(usd > 0 && fx > 0)) return
        model.solGbp = usd / fx
        if (Number(c?.plan?.monthlyPriceGbp) > 0) model.planGbp = Number(c.plan.monthlyPriceGbp)
        $('#priceSrc').textContent = `the current SOL price of about £${model.solGbp.toFixed(2)} (from Pyth)`
        render()
      })
      .catch(() => {})
  }
})()
