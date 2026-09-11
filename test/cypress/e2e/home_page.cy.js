describe('The Home Page', () => {
  it('shows phone-only contact options and no estimate form', () => {
    cy.intercept('POST', 'http://localhost:8787/api/visits', { statusCode: 202, body: { ok: true } })
    cy.visit('/')
    cy.get('#estimate-form').should('not.exist')
    cy.contains('Call for a Free Estimate').should('be.visible')
    cy.get('a[href="tel:+17245574429"]').should('be.visible')
    cy.get('a[href="tel:+17244390963"]').should('be.visible')
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

  it('shows the admin login button when there is no session', () => {
    cy.visit('/admin.html')
    cy.contains('button', 'Email me a sign-in link').should('be.visible')
    cy.get('#admin-dashboard').should('not.be.visible')
  })
})
