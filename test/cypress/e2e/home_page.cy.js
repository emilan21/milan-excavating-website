describe('The Home Page', () => {
  beforeEach(() => {
    cy.intercept('GET', 'https://challenges.cloudflare.com/turnstile/v0/api.js*', {
      statusCode: 200,
      body: '',
    })
  })

  function installTurnstile(win) {
    let callback
    win.turnstile = {
      render: (_target, options) => {
        callback = options.callback
        callback('fresh-token')
        return 'widget-1'
      },
      reset: () => callback('retry-token'),
    }
    win.onEstimateTurnstileLoad()
  }

  function fillEstimate() {
    cy.get('#estimate-name').type('Terry Milan')
    cy.get('#estimate-service').select('excavation')
    cy.get('#estimate-email').type('terry@example.com')
    cy.get('#estimate-location').type('Uniontown, PA')
    cy.get('#estimate-description').type('Excavate and prepare a new foundation area.')
    cy.get('input[name="preferredContact"][value="email"]').check()
  }

  it('submits an estimate and reports success', () => {
    cy.intercept('POST', 'http://localhost:8787/api/visits', { statusCode: 202, body: { ok: true } })
    cy.intercept('POST', 'http://localhost:8787/api/estimates', req => {
      expect(req.body.turnstileToken).to.equal('fresh-token')
      req.reply({ statusCode: 201, body: { ok: true } })
    }).as('estimate')
    cy.visit('/')
    cy.window().then(installTurnstile)
    fillEstimate()
    cy.get('#estimate-submit').click()
    cy.wait('@estimate')
    cy.get('#estimate-status').should('contain', 'estimate request was sent')
  })

  it('resets verification and permits a retry after failure', () => {
    let attempts = 0
    cy.intercept('POST', 'http://localhost:8787/api/visits', { statusCode: 202, body: { ok: true } })
    cy.intercept('POST', 'http://localhost:8787/api/estimates', req => {
      attempts += 1
      req.reply(attempts === 1
        ? { statusCode: 503, body: { error: { message: 'Please try again later' } } }
        : { statusCode: 201, body: { ok: true } })
    }).as('estimate')
    cy.visit('/')
    cy.window().then(installTurnstile)
    fillEstimate()
    cy.get('#estimate-submit').click()
    cy.wait('@estimate')
    cy.get('#estimate-status').should('contain', 'Please try again later')
    cy.get('#estimate-submit').click()
    cy.wait('@estimate')
    cy.get('#estimate-status').should('contain', 'estimate request was sent')
  })

  it('records a visit only once per browser session', () => {
    let visits = 0
    cy.intercept('POST', 'http://localhost:8787/api/visits', req => {
      visits += 1
      req.reply({ statusCode: 202, body: { ok: true } })
    }).as('visit')
    cy.visit('/')
    cy.wait('@visit')
    cy.reload()
    cy.then(() => expect(visits).to.equal(1))
  })
})
