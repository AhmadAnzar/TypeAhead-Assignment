    const searchInput = document.getElementById('search-input');
    const suggestionsList = document.getElementById('suggestions');
    const statLatency = document.getElementById('stat-latency');
    const statSource = document.getElementById('stat-source');
    const notification = document.getElementById('notif');
    const spinner = document.getElementById('loading-spinner');

    let debounceTimer;

    // Listen to keystrokes on the search input
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const query = searchInput.value;

      if (!query.trim()) {
        fetchTrendingSearches();
        return;
      }

      // Show the loading spinner when starting to fetch
      spinner.classList.add('visible');

      // 250ms Debounce:
      debounceTimer = setTimeout(() => {
        fetchSuggestions(query);
      }, 250);
    });

    // Listen to focus and click to show trending searches when empty
    searchInput.addEventListener('focus', () => {
      if (!searchInput.value.trim()) {
        fetchTrendingSearches();
      }
    });

    searchInput.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!searchInput.value.trim()) {
        fetchTrendingSearches();
      }
    });

    // Close suggestions dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const searchWrapper = document.querySelector('.search-wrapper');
      if (!searchWrapper.contains(e.target)) {
        clearSuggestions();
      }
    });

    let activeSuggestionIndex = -1;

    // Handle triggering search and keyboard navigation
    searchInput.addEventListener('keydown', (e) => {
      const items = suggestionsList.getElementsByClassName('suggestion-item');
      
      if (e.key === 'ArrowDown') {
        if (items.length > 0) {
          e.preventDefault();
          activeSuggestionIndex = (activeSuggestionIndex + 1) % items.length;
          updateSelectedSuggestion(items);
        }
      } else if (e.key === 'ArrowUp') {
        if (items.length > 0) {
          e.preventDefault();
          activeSuggestionIndex = (activeSuggestionIndex - 1 + items.length) % items.length;
          updateSelectedSuggestion(items);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeSuggestionIndex >= 0 && items[activeSuggestionIndex]) {
          const query = items[activeSuggestionIndex].querySelector('.suggestion-text').textContent;
          searchInput.value = query;
          clearSuggestions();
          triggerSearch(query);
        } else {
          const query = searchInput.value.trim();
          if (query) {
            clearSuggestions();
            triggerSearch(query);
          }
        }
      } else if (e.key === 'Escape') {
        clearSuggestions();
      }
    });

    function updateSelectedSuggestion(items) {
      for (let i = 0; i < items.length; i++) {
        items[i].classList.remove('selected');
      }
      if (activeSuggestionIndex >= 0 && items[activeSuggestionIndex]) {
        items[activeSuggestionIndex].classList.add('selected');
        const text = items[activeSuggestionIndex].querySelector('.suggestion-text').textContent;
        searchInput.value = text;
      }
    }

    async function fetchSuggestions(query) {
      const startTime = performance.now();
      try {
        const res = await fetch(`/suggest?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        
        const latency = Math.round(performance.now() - startTime);
        statLatency.textContent = `${latency} ms`;

        const cacheHeader = res.headers.get('X-Cache');
        statSource.textContent = cacheHeader === 'HIT' ? 'Redis Cache' : 'PostgreSQL Database';
        
        displaySuggestions(data);
      } catch (err) {
        console.error('Error fetching suggestions:', err);
      } finally {
        // Hide the loading spinner when request completes
        spinner.classList.remove('visible');
      }
    }

    function displaySuggestions(items) {
      activeSuggestionIndex = -1;
      suggestionsList.innerHTML = '';
      if (items.length === 0) {
        const li = document.createElement('li');
        li.className = 'suggestion-item';
        li.style.color = '#9aa0a6';
        li.style.pointerEvents = 'none';
        li.style.justifyContent = 'center';
        li.innerHTML = '<span class="suggestion-text" style="font-style: italic;">No results found</span>';
        suggestionsList.appendChild(li);
        suggestionsList.classList.add('active');
        return;
      }

      items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'suggestion-item';
        
        const textSpan = document.createElement('span');
        textSpan.className = 'suggestion-text';
        textSpan.textContent = item;

        li.appendChild(textSpan);

        li.addEventListener('click', () => {
          searchInput.value = item;
          clearSuggestions();
          triggerSearch(item);
        });

        suggestionsList.appendChild(li);
      });

      suggestionsList.classList.add('active');
    }

    const trendingIconSvg = `
      <svg class="trending-icon" viewBox="0 0 24 24" width="16" height="16" style="margin-right: 12px; flex-shrink: 0;">
        <defs>
          <linearGradient id="trendGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#ec4899" />
            <stop offset="100%" stop-color="#f97316" />
          </linearGradient>
        </defs>
        <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z" fill="url(#trendGrad)"/>
      </svg>
    `;

    async function fetchTrendingSearches() {
      spinner.classList.add('visible');
      try {
        const res = await fetch('/trending');
        const data = await res.json();
        displayTrending(data);
      } catch (err) {
        console.error('Error fetching trending searches:', err);
      } finally {
        spinner.classList.remove('visible');
      }
    }

    function displayTrending(items) {
      activeSuggestionIndex = -1;
      suggestionsList.innerHTML = '';
      if (items.length === 0) {
        suggestionsList.classList.remove('active');
        return;
      }

      // Add Trending Searches Header
      const headerLi = document.createElement('li');
      headerLi.className = 'trending-header';
      headerLi.innerHTML = `${trendingIconSvg} Trending Searches`;
      suggestionsList.appendChild(headerLi);

      items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'suggestion-item';
        
        const contentDiv = document.createElement('div');
        contentDiv.style.display = 'flex';
        contentDiv.style.alignItems = 'center';
        contentDiv.style.width = '100%';
        contentDiv.innerHTML = `${trendingIconSvg}<span class="suggestion-text">${item}</span>`;

        li.appendChild(contentDiv);

        li.addEventListener('click', () => {
          searchInput.value = item;
          clearSuggestions();
          triggerSearch(item);
        });

        suggestionsList.appendChild(li);
      });

      suggestionsList.classList.add('active');
    }

    function clearSuggestions() {
      suggestionsList.innerHTML = '';
      suggestionsList.classList.remove('active');
      spinner.classList.remove('visible');
      statSource.textContent = '-';
      statLatency.textContent = '- ms';
    }

    // Trigger Search (Simulate the Write Path)
    async function triggerSearch(query) {
      try {
        const response = await fetch('/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ query })
        });
        await response.json();

        // Show a brief standard notification
        notification.classList.add('show');
        setTimeout(() => {
          notification.classList.remove('show');
        }, 1500);

      } catch (err) {
        console.error('Error triggering search:', err);
      }
    }
