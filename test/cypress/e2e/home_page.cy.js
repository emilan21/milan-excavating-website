describe('The Home Page', () => {
  it('shows phone-only contact options and no estimate form', () => {
    cy.intercept('POST', '/api/visits', { statusCode: 202, body: { ok: true } })
    cy.visit('/')
    cy.get('#estimate-form').should('not.exist')
    cy.contains('Call for a Free Estimate').should('be.visible')
    cy.get('a[href="tel:+17245574429"]').should('be.visible')
    cy.get('a[href="tel:+17244390963"]').should('be.visible')
  })

  it('records a visit only once per browser session', () => {
    let visits = 0
    cy.intercept('POST', '/api/visits', req => {
      visits += 1
      req.reply({ statusCode: 202, body: { ok: true } })
    }).as('visit')
    cy.visit('/')
    cy.wait('@visit')
    cy.reload()
    cy.then(() => expect(visits).to.equal(1))
  })

  it('loads and manually refreshes the Access-protected dashboard', () => {
    cy.intercept('GET', '/admin/api/stats', { lifetime: 3, daily: [{ date: '2026-09-11', total: 3 }] }).as('stats')
    cy.visit('/admin.html')
    cy.wait('@stats')
    cy.get('#stat-visits').should('have.text', '3')
    cy.contains('td', '2026-09-11').should('be.visible')
    cy.get('#admin-refresh').click()
    cy.wait('@stats')
    cy.get('#admin-logout').should('have.attr', 'href', '/cdn-cgi/access/logout')
  })

  it('shows a safe dashboard failure state', () => {
    cy.intercept('GET', '/admin/api/stats', { statusCode: 503, body: { error: { code: 'service_unavailable' } } })
    cy.visit('/admin.html')
    cy.get('#admin-message').should('contain.text', 'Dashboard request failed (503)').and('have.class', 'admin-message--error')
  })
})
