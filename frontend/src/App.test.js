test('keeps every account session active when logout confirmation is cancelled', async () => {
  const token = tokenFor('faculty', 'faculty@plv.edu.ph');
  login.mockResolvedValue({ token });
  fetchUserProfile.mockResolvedValue({
    status: 'Success',
    data: {
      id: 7,
      email: 'faculty@plv.edu.ph',
      fullName: 'Test Faculty',
      role: 'faculty',
      status: 'APPROVED',
    },
  });

  window.confirm.mockReturnValue(false);
  window.history.replaceState({}, '', '/login');

  render(<App />);

  fireEvent.change(
    await screen.findByPlaceholderText(/example@plv.edu.ph/i),
    { target: { value: 'faculty@plv.edu.ph' } }
  );

  fireEvent.change(
    screen.getByPlaceholderText(/^password$/i),
    { target: { value: 'Password1!' } }
  );

  fireEvent.click(
    screen.getByRole('button', { name: /^sign in$/i })
  );

  await screen.findByText(
    /faculty portal for faculty@plv.edu.ph/i
  );

  fireEvent.click(
    screen.getByRole('button', { name: /^logout$/i })
  );

  expect(window.confirm).toHaveBeenCalledWith(
    'Are you sure you want to log out?'
  );

  expect(
    sessionStorage.getItem('blockgo.auth.token')
  ).toBe(token);

  expect(window.location.pathname).toBe('/faculty');

  expect(
    screen.getByText(/faculty portal for faculty@plv.edu.ph/i)
  ).toBeInTheDocument();
});

test('clears the shared account session only after logout is confirmed', async () => {
  const token = tokenFor('faculty', 'faculty@plv.edu.ph');

  login.mockResolvedValue({ token });

  fetchUserProfile.mockResolvedValue({
    status: 'Success',
    data: {
      id: 7,
      email: 'faculty@plv.edu.ph',
      fullName: 'Test Faculty',
      role: 'faculty',
      status: 'APPROVED',
    },
  });

  window.confirm.mockReturnValue(true);
  window.history.replaceState({}, '', '/login');

  render(<App />);

  fireEvent.change(
    await screen.findByPlaceholderText(/example@plv.edu.ph/i),
    { target: { value: 'faculty@plv.edu.ph' } }
  );

  fireEvent.change(
    screen.getByPlaceholderText(/^password$/i),
    { target: { value: 'Password1!' } }
  );

  fireEvent.click(
    screen.getByRole('button', { name: /^sign in$/i })
  );

  await screen.findByText(
    /faculty portal for faculty@plv.edu.ph/i
  );

  fireEvent.click(
    screen.getByRole('button', { name: /^logout$/i })
  );

  await waitFor(() =>
    expect(window.location.pathname).toBe('/login')
  );

  expect(window.confirm).toHaveBeenCalledWith(
    'Are you sure you want to log out?'
  );

  expect(
    sessionStorage.getItem('blockgo.auth.token')
  ).toBeNull();

  expect(
    screen.getByRole('button', { name: /sign in/i })
  ).toBeInTheDocument();
});

test('submits a Registrar password reset request without exposing the retired OTP flow', async () => {
  forgotPassword.mockResolvedValue({
    message:
      'If the account is eligible, a password reset request is now pending with the Registrar.',
  });

  render(<App />);

  fireEvent.click(
    await screen.findByText(/forgot password/i)
  );

  fireEvent.change(
    screen.getByPlaceholderText(/registered email/i),
    {
      target: {
        value: 'maria.santos@plv.edu.ph',
      },
    }
  );

  fireEvent.click(
    screen.getByRole('button', {
      name: /submit request/i,
    })
  );

  await waitFor(() =>
    expect(forgotPassword).toHaveBeenCalledWith(
      'maria.santos@plv.edu.ph'
    )
  );

  expect(
    await screen.findByText(/pending with the Registrar/i)
  ).toBeInTheDocument();

  expect(
    screen.queryByText(/reset otp|create new password/i)
  ).not.toBeInTheDocument();
});